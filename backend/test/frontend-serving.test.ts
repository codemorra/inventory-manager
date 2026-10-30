import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";

test("browser runtime separates API paths, assets and deep links without hiding API failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-browser-"));
  const frontend = join(directory, "frontend");
  const html = "<!doctype html><title>Synthetic frontend</title>";
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await mkdir(join(frontend, "assets"), { recursive: true });
    await writeFile(join(frontend, "index.html"), html);
    await writeFile(
      join(frontend, "assets/app.js"),
      "export const ready = true;",
    );
    runtime = await startServer({
      ...loadConfig({
        INVENTORY_DATA_DIR: join(directory, "storage"),
        INVENTORY_FRONTEND_DIR: frontend,
      }),
      port: 0,
    });
    const api = request(runtime.server);
    await api.get("/health").expect(200, { status: "ok" });
    await api.get("/api/health").expect(200, { status: "ok" });
    const inventory = (
      await api.post("/api/inventories").send({ name: "Synthetic" }).expect(201)
    ).body;
    await api.get(`/api/inventories/${inventory.id}/items`).expect(200, []);
    for (const path of [
      "/",
      "/settings",
      `/inventories/${inventory.id}/items`,
      `/inventories/${inventory.id}/fields/`,
    ]) {
      const response = await api
        .get(path)
        .set("Accept", "text/html")
        .expect(200);
      assert.equal(response.text, html);
      assert.equal(response.headers["cache-control"], "no-cache");
    }
    await api.get("/assets/app.js").expect(200, /export const ready/);
    await api.head("/settings").expect(200);
    for (const path of [
      "/api/unknown",
      "/api/assets/app.js",
      "/assets/missing.js",
      "/unknown",
      "/inventories",
    ]) {
      await api
        .get(path)
        .set("Accept", "text/html")
        .expect("Content-Type", /json/)
        .expect(404, { detail: "Not Found" });
    }
    const missing = await api.get("/api/inventories/missing").expect(404);
    assert.equal(missing.body.detail.code, "inventory_not_found");
    await api.post("/settings").expect(404);
    await api.get("/settings").set("Accept", "application/json").expect(404);
    const stale = await api
      .post("/api/inventories")
      .set("X-Inventory-Generation", "old-generation")
      .send({ name: "Rejected" })
      .expect(409);
    assert.equal(stale.body.detail.code, "application_data_changed");
    const invalid = await api.post("/api/inventories").send({}).expect(422);
    assert.ok(Array.isArray(invalid.body.detail));
    for (const prefix of ["", "/api"]) {
      const specification = await api.get(`${prefix}/openapi.json`).expect(200);
      assert.deepEqual(specification.body.servers, [{ url: "/api" }]);
      await api.get(`${prefix}/docs`).expect(200, /url: "\/api\/openapi.json"/);
      await api
        .get(`${prefix}/redoc`)
        .expect(200, /spec-url="\/api\/openapi.json"/);
    }
  } finally {
    await runtime?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("frontend serving is explicit and requires an absolute build directory", () => {
  assert.equal(loadConfig({}).frontendDirectory, undefined);
  assert.throws(() => loadConfig({ INVENTORY_FRONTEND_DIR: "frontend/dist" }));
});
