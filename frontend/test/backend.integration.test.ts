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

    const inventory = await inventories.createInventory({
      name: " Synthetic clients ",
      description: "Description",
    });
    expect(inventory.name).toBe("Synthetic clients");
    expect(await inventories.getInventories()).toEqual([inventory]);
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
      values: [
        { field_id: boolean.id, value: true },
        { field_id: select.id, value: option.id },
      ],
    });
    expect(updated.updated_at).toBe(item.updated_at);
    expect(
      updated.values.find((value) => value.field_id === boolean.id)?.value,
    ).toBe(true);
    expect(
      updated.values.find((value) => value.field_id === boolean.id)?.id,
    ).not.toBe(item.values.find((value) => value.field_id === boolean.id)?.id);
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
        values: [{ field_id: select.id, value: option.id }],
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_inventory_item_value",
    });
    expect(
      await items.deleteInventoryItem(inventory.id, item.id),
    ).toBeUndefined();
    expect(await items.getInventoryItems(inventory.id)).toEqual([]);
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
