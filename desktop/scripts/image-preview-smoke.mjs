import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Build bounded renderer operations shared by success and browser decode-error checks. */
function rendererOperations(evaluate) {
  const invoke = (operation, argument) =>
    evaluate(`(${operation.toString()})(${JSON.stringify(argument) ?? ""})`);
  const waitFor = async (operation, argument) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await invoke(operation, argument)) return;
      await delay(100);
    }
    throw new Error(`Renderer condition timed out: ${operation}`);
  };
  return { invoke, waitFor };
}

/**
 * Exercise actual renderer decoding and modal lifecycle, shared by source and packaged smoke tests.
 * @param {(expression: string) => Promise<any>} evaluate Execute JavaScript in the real renderer.
 * @param {{ filename: string, width: number, height: number, requestOffset?: number }} expected Synthetic image identity/dimensions.
 * @param {() => number} previewRequests Count actual preview network requests since navigation.
 */
export async function exerciseImagePreview(
  evaluate,
  expected,
  previewRequests,
) {
  const requestOffset = expected.requestOffset ?? 0;
  const { invoke, waitFor } = rendererOperations(evaluate);
  // Browser globals below run only inside the isolated application renderer.
  /* global document, window, MouseEvent, KeyboardEvent, getComputedStyle */
  await waitFor(
    (filename) =>
      [...document.querySelectorAll("a[download]")].some(
        (link) => link.textContent === filename,
      ),
    expected.filename,
  );
  await invoke(() => {
    document.querySelector("table")?.scrollIntoView();
    window.dispatchEvent(new Event("resize"));
  });
  await delay(300);
  assert.equal(
    previewRequests(),
    requestOffset,
    "Rendering/scrolling the table must not request image bytes.",
  );
  assert.equal(
    await invoke(() => document.querySelectorAll("table img").length),
    0,
  );
  await invoke((filename) => {
    window.__previewSmoke = {
      created: [],
      revoked: [],
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__previewSmoke.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__previewSmoke.revoked.push(url);
      revoke(url);
    };
    const link = [...document.querySelectorAll("a[download]")].find(
      (entry) => entry.textContent === filename,
    );
    link.focus();
    link.click();
  }, expected.filename);
  await waitFor(() => {
    const image = document.querySelector('[role="dialog"] img');
    return (
      image?.complete &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      getComputedStyle(image).visibility === "visible"
    );
  });
  const decoded = await invoke(() => {
    const image = document.querySelector('[role="dialog"] img');
    const dialog = image.closest('[role="dialog"]');
    const rect = dialog.getBoundingClientRect();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      displayedWidth: image.getBoundingClientRect().width,
      displayedHeight: image.getBoundingClientRect().height,
      modalWidth: rect.width,
      modalHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  assert.equal(decoded.width, expected.width);
  assert.equal(decoded.height, expected.height);
  assert.ok(
    decoded.modalWidth <= decoded.viewportWidth * 0.9 + 1,
    JSON.stringify(decoded),
  );
  assert.ok(
    decoded.modalHeight <= decoded.viewportHeight * 0.9 + 1,
    JSON.stringify(decoded),
  );
  assert.ok(
    Math.abs(decoded.modalWidth - decoded.viewportWidth * 0.9) < 2 ||
      Math.abs(decoded.modalHeight - decoded.viewportHeight * 0.9) < 2,
    `The image modal should grow until one viewport limit is reached: ${JSON.stringify(decoded)}`,
  );
  assert.ok(
    Math.abs(
      decoded.displayedWidth / decoded.displayedHeight -
        expected.width / expected.height,
    ) < 0.01,
    "The displayed image must retain its aspect ratio.",
  );
  assert.equal(
    previewRequests(),
    requestOffset + 1,
    "Only the explicitly selected image must be requested.",
  );
  await invoke(() => {
    const image = document.querySelector('[role="dialog"] img');
    image.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    );
  });
  await waitFor(
    () => !!document.querySelector('[role="menu"] [role="menuitem"]'),
  );
  // This is the app's download action. The host smoke test may handle the native Save As dialog.
  const menu = await invoke(() => {
    const menu = document.querySelector('[role="menu"]');
    return {
      icon: !!menu.querySelector("svg"),
      actions: menu.querySelectorAll('[role="menuitem"]').length,
    };
  });
  assert.equal(menu.icon, true);
  assert.equal(menu.actions, 1);
  await invoke(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(
    await invoke(() => !!document.querySelector('[role="dialog"]')),
    true,
    "Escape dismisses the context menu before the modal.",
  );
  await invoke(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await waitFor(() => !document.querySelector('[role="dialog"]'));
  const cleanup = await invoke(
    (filename) => ({
      created: window.__previewSmoke.created,
      revoked: window.__previewSmoke.revoked,
      focused: document.activeElement?.textContent === filename,
    }),
    expected.filename,
  );
  assert.deepEqual(cleanup.revoked, cleanup.created);
  assert.equal(cleanup.created.length, 1);
  assert.equal(cleanup.focused, true);
  // Reopening must fetch afresh rather than retaining a global image/blob cache.
  await invoke(
    (filename) =>
      [...document.querySelectorAll("a[download]")]
        .find((link) => link.textContent === filename)
        .click(),
    expected.filename,
  );
  await waitFor(() => {
    const image = document.querySelector('[role="dialog"] img');
    return (
      image?.complete &&
      image.naturalWidth > 0 &&
      getComputedStyle(image).visibility === "visible"
    );
  });
  assert.equal(previewRequests(), requestOffset + 2);
  await invoke(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await waitFor(() => !document.querySelector('[role="dialog"]'));
  assert.equal(await invoke(() => window.__previewSmoke.revoked.length), 2);
  await invoke(() => {
    URL.createObjectURL = window.__previewSmoke.create;
    URL.revokeObjectURL = window.__previewSmoke.revoke;
    delete window.__previewSmoke;
  });
}

/** Verify that a real browser decode error keeps the original-download action available. */
export async function exerciseImagePreviewFailure(evaluate, filename) {
  const { invoke, waitFor } = rendererOperations(evaluate);
  await waitFor(
    (name) =>
      [...document.querySelectorAll("a[download]")].some(
        (link) => link.textContent === name,
      ),
    filename,
  );
  await invoke(
    (name) =>
      [...document.querySelectorAll("a[download]")]
        .find((link) => link.textContent === name)
        .click(),
    filename,
  );
  await waitFor(
    () => !!document.querySelector('[role="dialog"] [role="alert"]'),
  );
  assert.equal(
    await invoke(() => !!document.querySelector('[role="dialog"] img')),
    false,
  );
  await invoke(() =>
    document
      .querySelector('[role="dialog"] [role="alert"]')
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
  );
  await waitFor(() => !!document.querySelector('[role="menuitem"]'));
  await invoke(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await invoke(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await waitFor(() => !document.querySelector('[role="dialog"]'));
}
