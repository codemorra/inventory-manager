import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { app, dialog, shell } from "electron";
import { startDesktop } from "../dist/application.js";

/** Exercise the real Electron host using only the test runner's temporary data. */
async function run() {
  const watchdog = setTimeout(() => {
    console.error("Electron smoke test exceeded its 45-second deadline.");
    app.exit(1);
  }, 45_000);
  watchdog.unref();
  const root = process.env.INVENTORY_DATA_DIR;
  if (!root || !process.env.INVENTORY_DESKTOP_SMOKE_PHASE)
    throw new Error("Run this test through npm run smoke.");
  // Keep this test independent of the user's display setup while retaining Chromium's sandbox.
  app.commandLine.appendSwitch("ozone-platform", "headless");
  const report = join(root, "config/smoke.json");
  let runtime;
  try {
    runtime = await startDesktop({ show: false });
    assert.ok(runtime);
    const { window, origin } = runtime;
    /**
     * Send requests only to this test's isolated backend.
     * @param {string} path API path relative to /api.
     * @param {RequestInit & {status?: number}} options Request options and expected status.
     * @returns {Promise<unknown>} The checked JSON response, if any.
     */
    async function api(path, options = {}) {
      const response = await fetch(origin + "/api" + path, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(
        response.status,
        options.status ?? 200,
        `${path}: ${response.status}`,
      );
      return response.status === 204 ? undefined : response.json();
    }
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(
      await window.webContents.executeJavaScript("typeof window.require"),
      "undefined",
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await window.webContents.executeJavaScript(
          "!!document.querySelector('button')",
        )
      )
        break;
      await delay(50);
    }
    assert.equal(
      await window.webContents.executeJavaScript(
        "!!document.querySelector('button')",
      ),
      true,
    );
    assert.equal((await api("/health")).status, "ok");
    if (process.env.INVENTORY_DESKTOP_SMOKE_PHASE === "seed") {
      const activated = once(app, "second-instance", {
        signal: AbortSignal.timeout(10000),
      });
      const duplicate = spawn(
        process.execPath,
        [
          "--ozone-platform=headless",
          fileURLToPath(new URL("../dist/main.js", import.meta.url)),
        ],
        { env: process.env, stdio: "ignore" },
      );
      const duplicateExit = once(duplicate, "exit", {
        signal: AbortSignal.timeout(10000),
      });
      await activated;
      assert.deepEqual(await duplicateExit, [0, null]);
      const bounds = window.getNormalBounds();
      window.setSize(
        Math.max(200, bounds.width - 80),
        Math.max(200, bounds.height - 60),
      );
      const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQYlWNg6EgjjBhGvCIAduVZQWDem3YAAAAASUVORK5CYII=",
        "base64",
      );
      const inventory = await api("/inventories", {
        method: "POST",
        status: 201,
        body: JSON.stringify({ name: "Electron synthetic" }),
      });
      const field = await api(`/inventories/${inventory.id}/fields`, {
        method: "POST",
        status: 201,
        body: JSON.stringify({ name: "Image", field_type: "attachment" }),
      });
      const path = `/inventories/${inventory.id}/fields/${field.id}/attachments`;
      const file = await api(path, {
        method: "POST",
        status: 201,
        body: bytes,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": "test.png",
        },
      });
      await api(`/inventories/${inventory.id}/items`, {
        method: "POST",
        status: 201,
        body: JSON.stringify({
          values: [{ field_id: field.id, value: [file.id] }],
        }),
      });
      const preview = await fetch(
        origin + "/api" + path + `/${file.id}/preview`,
      );
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("content-type"), "image/webp");
      const downloaded = new Promise((resolve, reject) => {
        window.webContents.session.once("will-download", (_event, item) => {
          assert.ok(
            item.getSaveDialogOptions().defaultPath.endsWith("test.png"),
          );
          item.setSavePath(join(root, "download.png"));
          item.once("done", (_event, state) =>
            state === "completed" ? resolve() : reject(new Error(state)),
          );
        });
      });
      window.webContents.downloadURL(
        origin + "/api" + path + `/${file.id}/download`,
      );
      await downloaded;
      assert.deepEqual(await readFile(join(root, "download.png")), bytes);
      const settings = await api("/application-settings");
      await api("/application-settings", {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: settings.revision,
          preferences: { language: "en", theme: "dark" },
        }),
      });
      const backup = await api("/backups", { method: "POST", status: 201 });
      await api("/inventories", {
        method: "POST",
        status: 201,
        body: JSON.stringify({ name: "After backup" }),
      });
      const restore = await api("/backup-restores", {
        method: "POST",
        status: 201,
        body: JSON.stringify({ filename: backup.filename }),
      });
      await api(`/backup-restores/${restore.id}/confirm`, { method: "POST" });
      assert.equal((await api("/inventories")).length, 1);
      const storage = await api("/storage-locations");
      await api("/storage-locations", {
        method: "PUT",
        body: JSON.stringify({
          expected_revision: storage.revision,
          dataDirectory: join(root, "moved/data"),
          backupsDirectory: join(root, "moved/backups"),
        }),
      });
      const opened = [];
      const originalOpen = shell.openExternal;
      shell.openExternal = async (url) => {
        opened.push(url);
      };
      await window.webContents.executeJavaScript(
        "window.open('https://example.com/desktop-test'); void 0",
      );
      assert.deepEqual(opened, ["https://example.com/desktop-test"]);
      shell.openExternal = originalOpen;
      await writeFile(
        report,
        JSON.stringify({
          inventory,
          field,
          file,
          backup,
          image: bytes.toString("base64"),
        }),
      );
      console.log(
        "PASS: real Electron renderer, isolated Node backend, single instance, native modules, downloads/previews, backup/restore, storage relocation and external-link handling",
      );
    } else {
      const saved = JSON.parse(await readFile(report, "utf8"));
      assert.equal((await api("/inventories"))[0].id, saved.inventory.id);
      const settings = await api("/application-settings");
      assert.equal(settings.preferences.theme, "dark");
      assert.equal(settings.preferences.language, "en");
      const storage = await api("/storage-locations");
      assert.equal(storage.paths.dataDirectory, join(root, "moved/data"));
      const response = await fetch(
        `${origin}/api/inventories/${saved.inventory.id}/fields/${saved.field.id}/attachments/${saved.file.id}/download`,
      );
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        Buffer.from(saved.image, "base64"),
      );
      assert.ok(
        (await api("/backups")).some(
          (backup) => backup.filename === saved.backup.filename,
        ),
      );
      assert.match(
        await readFile(join(root, "logs/inventory-manager.log"), "utf8"),
        /Application stopped/,
      );
      const windowState = JSON.parse(
        await readFile(join(root, "config/window-state.json"), "utf8"),
      );
      assert.equal(window.getNormalBounds().width, windowState.bounds.width);
      console.log(
        "PASS: restart preserves preferences, inventory, attachments, backup archives, relocated paths, window size and clean-shutdown log",
      );
    }
    let questions = 0;
    dialog.showMessageBoxSync = () => {
      questions++;
      return 0;
    };
    await window.webContents.executeJavaScript(
      "window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });",
    );
    if (process.env.INVENTORY_DESKTOP_SMOKE_PHASE === "verify") app.quit();
    else window.close();
    for (let i = 0; i < 100 && questions === 0; i++) await delay(20);
    assert.equal(questions, 1);
    assert.equal(window.isDestroyed(), false);
    dialog.showMessageBoxSync = () => 1;
    if (process.env.INVENTORY_DESKTOP_SMOKE_PHASE === "verify") app.quit();
    else window.close();
    await runtime.stopped;
    console.log(
      "PASS: unsaved-change confirmation respects cancel and waits for graceful backend shutdown on leave",
    );
  } catch (error) {
    console.error(error);
    if (runtime) await runtime.backend.stop().catch(console.error);
    app.exit(1);
  }
}
void run();
