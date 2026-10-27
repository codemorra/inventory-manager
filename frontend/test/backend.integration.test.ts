/// <reference types="node" />
// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";

// Test that the frontend clients can complete configuration and item CRUD against an Express backend
test("frontend clients complete configuration and item CRUD against Express", async () => {
  const dataDirectory = await mkdtemp(
    join(tmpdir(), "inventory-client-contract-"),
  );
  const backendDirectory = fileURLToPath(
    new URL("../../backend/", import.meta.url),
  );
  const probe = createServer();
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<[number | null, NodeJS.Signals | null]> | undefined;
  try {
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    if (!address || typeof address === "string")
      throw new Error("No temporary test port available.");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );

    child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: backendDirectory,
      env: {
        ...process.env,
        INVENTORY_DATA_DIR: dataDirectory,
        INVENTORY_DB_PATH: join(dataDirectory, "inventory.db"),
        INVENTORY_HOST: "127.0.0.1",
        INVENTORY_PORT: String(port),
        INVENTORY_LOG_LEVEL: "INFO",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    exited = new Promise((resolve, reject) => {
      child!.once("exit", (code, signal) => resolve([code, signal]));
      child!.once("error", reject);
    });
    // Handle early spawn failure while readiness is being checked.
    void exited.catch(() => {});
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null)
        throw new Error(`Express exited before readiness: ${stderr}`);
      try {
        const response = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(200),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Retry until the process has initialized its fresh database. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Express did not become ready: ${stderr}`);

    vi.stubEnv("VITE_API_BASE_URL", url);
    vi.resetModules();
    const inventories = await import("../src/services/inventories");
    const fields = await import("../src/services/inventoryFields");
    const items = await import("../src/services/inventoryItems");
    const { ApiError } = await import("../src/services/api");
    const groups = await import("../src/services/inventoryGroups");

    const inventory = await inventories.createInventory({
      name: " Synthetic clients ",
      description: "Description",
    });
    expect(inventory.name).toBe("Synthetic clients");
    expect(await inventories.getInventories()).toEqual([inventory]);
    const group = await groups.createInventoryGroup("Leisure");
    expect(
      (await inventories.updateInventory(inventory.id, { group_id: group.id }))
        .group_id,
    ).toBe(group.id);
    expect((await groups.updateInventoryGroup(group.id, "Hobbies")).name).toBe(
      "Hobbies",
    );
    await groups.deleteInventoryGroup(group.id);
    expect(await groups.getInventoryGroups()).toEqual([]);
    expect((await inventories.getInventories())[0]?.group_id).toBeNull();
    expect(
      (await inventories.updateInventory(inventory.id, { description: null }))
        .description,
    ).toBeNull();
    const boolean = await fields.createInventoryField(inventory.id, {
      name: "Completed",
      field_type: "boolean",
    });
    const select = await fields.createInventoryField(inventory.id, {
      name: "Category",
      field_type: "select",
      options: [{ name: "First" }],
    });
    expect(
      (await fields.getInventoryFields(inventory.id)).map((field) => field.id),
    ).toEqual([boolean.id, select.id]);
    expect(
      await fields.getInventoryFieldOptions(inventory.id, select.id),
    ).toEqual(select.options);
    const option = await fields.createInventoryFieldOption(
      inventory.id,
      select.id,
      { name: "Second" },
    );
    expect(
      (
        await fields.updateInventoryFieldOption(
          inventory.id,
          select.id,
          option.id,
          { name: "Renamed" },
        )
      ).name,
    ).toBe("Renamed");
    expect(
      (
        await fields.updateInventoryField(inventory.id, boolean.id, {
          name: "Done",
        })
      ).name,
    ).toBe("Done");
    const item = await items.createInventoryItem(inventory.id, {
      values: [
        { field_id: boolean.id, value: false },
        { field_id: select.id, value: option.id },
      ],
    });
    expect(await items.getInventoryItems(inventory.id)).toEqual([item]);
    const updated = await items.updateInventoryItem(inventory.id, item.id, {
      expected_revision: (await items.getInventoryItems(inventory.id)).find(
        (entry) => entry.id === item.id,
      )!.revision,
      values: [
        { field_id: boolean.id, value: true },
        { field_id: select.id, value: option.id },
      ],
    });
    expect(updated.revision).toBe(item.revision + 1);
    // Two frontend clients holding the same item revision cannot overwrite or delete a newer save.
    await expect(
      items.updateInventoryItem(inventory.id, item.id, {
        expected_revision: item.revision,
        values: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "inventory_item_conflict" });
    await expect(
      items.deleteInventoryItem(inventory.id, item.id, item.revision),
    ).rejects.toMatchObject({ status: 409, code: "inventory_item_conflict" });
    expect(await items.getInventoryItems(inventory.id)).toEqual([updated]);
    expect(
      updated.values.find((value) => value.field_id === boolean.id)?.value,
    ).toBe(true);
    expect(
      updated.values.find((value) => value.field_id === boolean.id)?.id,
    ).not.toBe(item.values.find((value) => value.field_id === boolean.id)?.id);

    // Exercise the draft client's atomic contract against the actual SQLite-backed server.
    const { saveInventoryConfiguration, getInventoryConfiguration } =
      await import("../src/services/inventoryEditor");
    const editorSnapshot = await getInventoryConfiguration(inventory.id);
    let saved = await saveInventoryConfiguration(inventory.id, {
      expected_revision: (await getInventoryConfiguration(inventory.id))
        .inventory.configuration_revision,
      inventory: {
        name: "Saved editor draft",
        description: "Atomic configuration",
      },
      fields: [
        { action: "update", field_id: boolean.id, data: { name: "Played" } },
        {
          action: "create",
          data: { name: "Notes", field_type: "text", max_length: 500 },
        },
      ],
      options: [
        {
          action: "update",
          field_id: select.id,
          option_id: option.id,
          data: { name: "Priority" },
        },
      ],
    });
    expect(saved.inventory.name).toBe("Saved editor draft");
    expect(saved.fields.map((field) => field.name)).toEqual([
      "Played",
      "Category",
      "Notes",
    ]);
    expect(
      saved.fields[1]?.options.find((entry) => entry.id === option.id)?.name,
    ).toBe("Priority");
    expect(await fields.getInventoryFields(inventory.id)).toEqual(saved.fields);
    await expect(
      saveInventoryConfiguration(inventory.id, {
        expected_revision: editorSnapshot.inventory.configuration_revision,
        inventory: { name: "Stale draft", description: null },
        fields: [],
        options: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "inventory_configuration_conflict",
    });
    expect(await getInventoryConfiguration(inventory.id)).toEqual(saved);
    expect(await items.getInventoryItems(inventory.id)).toEqual([updated]);
    // Exercise generated saved/temporary order references against the real transaction endpoint.
    const { buildInventoryEditorInput, createDraftField } =
      await import("../src/components/inventoryEditorDraft");
    const draftField = createDraftField(inventory.id, {
      name: "Quantity",
      field_type: "number",
    });
    saved = await saveInventoryConfiguration(
      inventory.id,
      buildInventoryEditorInput(
        saved.fields,
        [draftField, ...saved.fields.toReversed()],
        {
          name: saved.inventory.name,
          description: saved.inventory.description,
        },
        (await getInventoryConfiguration(inventory.id)).inventory
          .configuration_revision,
      ),
    );
    expect(saved.fields.map((field) => [field.name, field.position])).toEqual([
      ["Quantity", 0],
      ["Notes", 1],
      ["Category", 2],
      ["Played", 3],
    ]);
    expect(saved.fields[0]?.id).not.toBe(draftField.id);
    expect(await fields.getInventoryFields(inventory.id)).toEqual(saved.fields);
    expect(await items.getInventoryItems(inventory.id)).toEqual([updated]);
    await expect(
      saveInventoryConfiguration(inventory.id, {
        expected_revision: (await getInventoryConfiguration(inventory.id))
          .inventory.configuration_revision,
        inventory: { name: "Must roll back", description: null },
        fields: [
          {
            action: "create",
            data: { name: "Temporary field", field_type: "text" },
          },
        ],
        options: [
          { action: "delete", field_id: select.id, option_id: "missing" },
        ],
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "inventory_field_option_not_found",
    });
    expect((await inventories.getInventories())[0]?.name).toBe(
      "Saved editor draft",
    );
    expect(await fields.getInventoryFields(inventory.id)).toEqual(saved.fields);
    expect(await items.getInventoryItems(inventory.id)).toEqual([updated]);
    expect(
      await fields.deleteInventoryFieldOption(
        inventory.id,
        select.id,
        option.id,
      ),
    ).toBeUndefined();
    expect(
      (await items.getInventoryItems(inventory.id))[0]?.values.find(
        (value) => value.field_id === select.id,
      )?.value,
    ).toBe(option.id);
    await expect(
      items.updateInventoryItem(inventory.id, item.id, {
        expected_revision: (await items.getInventoryItems(inventory.id)).find(
          (entry) => entry.id === item.id,
        )!.revision,
        values: [{ field_id: select.id, value: option.id }],
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_inventory_item_value",
    });
    // Exercise automatic numbering with a real draft save and complete item replacement.
    const numberDraft = createDraftField(inventory.id, {
      name: "Reference",
      field_type: "id",
    });
    const numbered = await saveInventoryConfiguration(
      inventory.id,
      buildInventoryEditorInput(
        saved.fields,
        [numberDraft, ...saved.fields],
        {
          name: saved.inventory.name,
          description: saved.inventory.description,
        },
        (await getInventoryConfiguration(inventory.id)).inventory
          .configuration_revision,
      ),
    );
    const automatic = numbered.fields.find(
      (field) => field.field_type === "id",
    )!;
    expect(automatic.reuse_deleted_ids).toBe(false);
    const numberedItem = (await items.getInventoryItems(inventory.id))[0]!;
    const assigned = numberedItem.values.find(
      (value) => value.field_id === automatic.id,
    )!;
    expect(assigned.value).toBe(1);
    const replaced = await items.updateInventoryItem(inventory.id, item.id, {
      expected_revision: (await items.getInventoryItems(inventory.id)).find(
        (entry) => entry.id === item.id,
      )!.revision,
      values: [],
    });
    expect(replaced.values).toEqual([assigned]);
    await items.deleteInventoryItem(
      inventory.id,
      item.id,
      (await items.getInventoryItems(inventory.id)).find(
        (entry) => entry.id === item.id,
      )!.revision,
    );
    const nextNumbered = await items.createInventoryItem(inventory.id, {
      values: [],
    });
    expect(nextNumbered.values[0]?.value).toBe(2);
    await saveInventoryConfiguration(
      inventory.id,
      buildInventoryEditorInput(
        numbered.fields,
        numbered.fields.map((field) =>
          field.id === automatic.id
            ? { ...field, reuse_deleted_ids: true }
            : field,
        ),
        {
          name: saved.inventory.name,
          description: saved.inventory.description,
        },
        (await getInventoryConfiguration(inventory.id)).inventory
          .configuration_revision,
      ),
    );
    const reusedNumbered = await items.createInventoryItem(inventory.id, {
      values: [],
    });
    expect(reusedNumbered.values[0]?.value).toBe(1);
    await items.deleteInventoryItem(
      inventory.id,
      reusedNumbered.id,
      (await items.getInventoryItems(inventory.id)).find(
        (entry) => entry.id === reusedNumbered.id,
      )!.revision,
    );
    expect(
      await items.deleteInventoryItem(
        inventory.id,
        nextNumbered.id,
        (await items.getInventoryItems(inventory.id)).find(
          (entry) => entry.id === nextNumbered.id,
        )!.revision,
      ),
    ).toBeUndefined();
    expect(await items.getInventoryItems(inventory.id)).toEqual([]);
    // Verify URL drafts and form payloads round-trip through the real backend without losing display text.
    const currentFields = await fields.getInventoryFields(inventory.id);
    const urlDraft = createDraftField(inventory.id, {
      name: "Website",
      field_type: "url",
      is_required: true,
    });
    const linkConfiguration = await saveInventoryConfiguration(
      inventory.id,
      buildInventoryEditorInput(
        currentFields,
        [...currentFields, urlDraft],
        {
          name: saved.inventory.name,
          description: saved.inventory.description,
        },
        (await getInventoryConfiguration(inventory.id)).inventory
          .configuration_revision,
      ),
    );
    const urlField = linkConfiguration.fields.find(
      (field) => field.field_type === "url",
    )!;
    const {
      createValueInput,
      getEditableValue,
      hasValidItemValues,
      createCheckboxReplacement,
    } = await import("../src/components/inventoryItemForm");
    const linkValue = {
      url: "https://example.com/docs?q=1#help",
      label: "Documentation",
    };
    const linkItem = await items.createInventoryItem(inventory.id, {
      values: [createValueInput(urlField, linkValue)!],
    });
    expect(
      linkItem.values.find((value) => value.field_id === urlField.id)?.value,
    ).toEqual(linkValue);
    expect(getEditableValue(urlField, linkValue)).toEqual(linkValue);
    const bareLink = await items.updateInventoryItem(
      inventory.id,
      linkItem.id,
      {
        expected_revision: (await items.getInventoryItems(inventory.id)).find(
          (entry) => entry.id === linkItem.id,
        )!.revision,
        values: [createValueInput(urlField, { ...linkValue, label: "" })!],
      },
    );
    expect(
      bareLink.values.find((value) => value.field_id === urlField.id)?.value,
    ).toEqual({ url: linkValue.url });
    for (const value of [
      { url: "javascript:alert(1)" },
      { url: "https://example.com\n" },
      { url: "", label: "No destination" },
    ]) {
      expect(hasValidItemValues([urlField], { [urlField.id]: value })).toBe(
        false,
      );
      await expect(
        items.updateInventoryItem(inventory.id, linkItem.id, {
          expected_revision: (await items.getInventoryItems(inventory.id)).find(
            (entry) => entry.id === linkItem.id,
          )!.revision,
          values: [{ field_id: urlField.id, value }],
        }),
      ).rejects.toMatchObject({ status: 422 });
    }
    await expect(
      items.updateInventoryItem(inventory.id, linkItem.id, {
        expected_revision: (await items.getInventoryItems(inventory.id)).find(
          (entry) => entry.id === linkItem.id,
        )!.revision,
        values: [],
      }),
    ).rejects.toMatchObject({ status: 422 });
    await fields.updateInventoryField(inventory.id, urlField.id, {
      is_required: false,
    });
    const clearedLink = await items.updateInventoryItem(
      inventory.id,
      linkItem.id,
      {
        expected_revision: (await items.getInventoryItems(inventory.id)).find(
          (entry) => entry.id === linkItem.id,
        )!.revision,
        values: [],
      },
    );
    expect(
      clearedLink.values.some((value) => value.field_id === urlField.id),
    ).toBe(false);
    // Direct checkbox interaction uses the same full-replacement endpoint and preserves other typed values.
    const checkboxBefore = await fields.getInventoryFields(inventory.id);
    const checkboxDraft = createDraftField(inventory.id, {
      name: "Checked",
      field_type: "checkbox",
      is_required: true,
    });
    const checkboxConfiguration = await saveInventoryConfiguration(
      inventory.id,
      buildInventoryEditorInput(
        checkboxBefore,
        [...checkboxBefore, checkboxDraft],
        {
          name: saved.inventory.name,
          description: saved.inventory.description,
        },
        (await getInventoryConfiguration(inventory.id)).inventory
          .configuration_revision,
      ),
    );
    const checkbox = checkboxConfiguration.fields.find(
      (field) => field.field_type === "checkbox",
    )!;
    const quantity = checkboxConfiguration.fields.find(
      (field) => field.field_type === "number",
    )!;
    const checkable = await items.updateInventoryItem(
      inventory.id,
      linkItem.id,
      {
        expected_revision: (await items.getInventoryItems(inventory.id)).find(
          (entry) => entry.id === linkItem.id,
        )!.revision,
        values: [
          { field_id: checkbox.id, value: false },
          { field_id: urlField.id, value: linkValue },
          { field_id: quantity.id, value: 0 },
        ],
      },
    );
    const idAssignment = checkable.values.find(
      (value) => value.field_id === automatic.id,
    );
    const checked = await items.updateInventoryItem(
      inventory.id,
      checkable.id,
      createCheckboxReplacement(
        checkboxConfiguration.fields,
        checkable,
        checkbox.id,
        true,
      ),
    );
    expect(
      checked.values.find((value) => value.field_id === checkbox.id)?.value,
    ).toBe(true);
    expect(
      checked.values.find((value) => value.field_id === urlField.id)?.value,
    ).toEqual(linkValue);
    expect(
      checked.values.find((value) => value.field_id === quantity.id)?.value,
    ).toBe(0);
    expect(
      checked.values.find((value) => value.field_id === automatic.id),
    ).toEqual(idAssignment);
    const unchecked = await items.updateInventoryItem(
      inventory.id,
      checkable.id,
      createCheckboxReplacement(
        checkboxConfiguration.fields,
        checked,
        checkbox.id,
        false,
      ),
    );
    expect(
      unchecked.values.find((value) => value.field_id === checkbox.id)?.value,
    ).toBe(false);
    const laterRequired = await saveInventoryConfiguration(inventory.id, {
      expected_revision: (await getInventoryConfiguration(inventory.id))
        .inventory.configuration_revision,
      inventory: {
        name: saved.inventory.name,
        description: saved.inventory.description,
      },
      options: [],
      fields: [
        {
          action: "create",
          data: { name: "Later required", is_required: true },
        },
      ],
    });
    await expect(
      items.updateInventoryItem(
        inventory.id,
        checkable.id,
        createCheckboxReplacement(
          laterRequired.fields,
          unchecked,
          checkbox.id,
          true,
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      (await items.getInventoryItems(inventory.id)).find(
        (entry) => entry.id === unchecked.id,
      ),
    ).toEqual(unchecked);
    await items.deleteInventoryItem(
      inventory.id,
      linkItem.id,
      (await items.getInventoryItems(inventory.id)).find(
        (entry) => entry.id === linkItem.id,
      )!.revision,
    );
    expect(
      await fields.deleteInventoryField(inventory.id, select.id),
    ).toBeUndefined();
    expect(await inventories.deleteInventory(inventory.id)).toBeUndefined();
    await expect(
      fields.getInventoryFields(inventory.id),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(fields.getInventoryFields(inventory.id)).rejects.toMatchObject(
      { status: 404, code: "inventory_not_found" },
    );
    await expect(
      inventories.createInventory({ name: "" }),
    ).rejects.toMatchObject({
      status: 422,
      message: "An unexpected error occurred.",
    });
    // Exercise the real binary transport, staged ownership, and streamed download contract.
    const attachments = await import("../src/services/attachments");
    const fileInventory = await inventories.createInventory({
      name: "File clients",
    });
    const fileField = await fields.createInventoryField(fileInventory.id, {
      name: "Files",
      field_type: "attachment",
    });
    const staged = await attachments.uploadAttachment(
      fileInventory.id,
      fileField.id,
      new File(["Managed file content"], "Prüfung.txt", { type: "text/plain" }),
    );
    const fileItem = await items.createInventoryItem(fileInventory.id, {
      values: [{ field_id: fileField.id, value: [staged.id] }],
    });
    expect(fileItem.attachments?.[0]).toMatchObject({
      id: staged.id,
      item_id: fileItem.id,
      filename: "Prüfung.txt",
    });
    const download = await fetch(attachments.attachmentDownloadUrl(staged));
    expect(download.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(await download.text()).toBe("Managed file content");
    const image = await attachments.uploadAttachment(
      fileInventory.id,
      fileField.id,
      new File(["Image test bytes"], "photo.png", { type: "image/png" }),
    );
    const imageDownload = await fetch(attachments.attachmentDownloadUrl(image));
    expect(imageDownload.headers.get("Content-Disposition")).toMatch(
      /^attachment;.*photo\.png/,
    );
    expect(imageDownload.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(await imageDownload.text()).toBe("Image test bytes");
    await attachments.discardAttachment(image);
    await expect(attachments.discardAttachment(staged)).rejects.toMatchObject({
      status: 409,
    });
    const unused = await attachments.uploadAttachment(
      fileInventory.id,
      fileField.id,
      new File(["Discard"], "unused.txt"),
    );
    await attachments.discardAttachment(unused);
    expect(
      (await fetch(attachments.attachmentDownloadUrl(unused))).status,
    ).toBe(404);
    await inventories.deleteInventory(fileInventory.id);
    expect(await inventories.getInventories()).toEqual([]);
  } finally {
    if (probe.listening) probe.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    if (child && exited) {
      const forceStop = setTimeout(() => child?.kill("SIGKILL"), 3000);
      try {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        const [code] = await exited;
        expect(code).toBe(0);
      } finally {
        clearTimeout(forceStop);
      }
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
}, 15_000);
