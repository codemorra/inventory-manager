import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [first, second = first, ...extra] = process.argv.slice(2);
if (!first || extra.length)
  throw new Error("Provide one or two packaged application paths.");

/**
 * Reserve a loopback port for the temporary Chromium debugging endpoint.
 * @returns {Promise<number>} An available port.
 */
async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/**
 * Send a command to the isolated renderer's debugging endpoint.
 * @param {WebSocket} socket Renderer connection.
 * @param {number} id Command identifier.
 * @param {string} method Debugging protocol method.
 * @param {object} params Command arguments.
 * @returns {Promise<object>} Debugging protocol response.
 */
async function command(socket, id, method, params = {}) {
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${method}.`));
    }, 10000);
    /** @param {MessageEvent} event Debugging protocol response. */
    function onMessage(event) {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
    socket.addEventListener("message", onMessage);
  });
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}

/**
 * Stop a failed test application and, on Windows, its portable launcher children.
 * @param {import("node:child_process").ChildProcess} child Test process.
 * @param {() => boolean} hasExited Whether the process has already exited.
 * @returns {Promise<void>} Resolves after the process has exited.
 * @throws {Error} When the test process cannot be stopped.
 */
async function stopFailedApplication(child, hasExited) {
  const stopped = once(child, "exit", { signal: AbortSignal.timeout(10000) });
  void stopped.catch(() => {});
  if (process.platform === "win32") {
    assert.ok(child.pid);
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "inherit",
    });
    const [code] = await once(killer, "exit", {
      signal: AbortSignal.timeout(10000),
    });
    if (code !== 0 && !hasExited())
      throw new Error(`Failed to stop packaged application (${code}).`);
  } else {
    child.kill();
  }
  await stopped;
}

/**
 * Start one packaged application with isolated storage, then close it cleanly.
 * @param {string} executable Application artifact.
 * @param {string} directory Temporary application root.
 * @param {(origin: string) => Promise<void>} exercise Checks to run against its backend.
 * @returns {Promise<void>} Resolves after a clean application shutdown.
 */
async function runApplication(executable, directory, exercise) {
  const port = await availablePort();
  const startupDeadline = Date.now() + 180000;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.toUpperCase().startsWith("INVENTORY_") &&
        key.toUpperCase() !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  environment.INVENTORY_DATA_DIR = directory;
  const child = spawn(
    resolve(process.env.INIT_CWD ?? process.cwd(), executable),
    ["--ozone-platform=headless", `--remote-debugging-port=${port}`],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let exit;
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  child.once("error", (error) => (exit = { error }));
  child.once("exit", (code, signal) => (exit = { code, signal }));
  let socket;
  try {
    let page;
    console.log(
      "Starting packaged application; extraction may take several minutes.",
    );
    while (Date.now() < startupDeadline) {
      if (exit)
        throw new Error(
          `Packaged application exited ${JSON.stringify(exit)}: ${output}`,
        );
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1000),
        });
        if (!response.ok)
          throw new Error(`Debug endpoint returned ${response.status}.`);
        page = (await response.json()).find(
          (entry) =>
            entry.type === "page" && entry.url.startsWith("http://127.0.0.1:"),
        );
        if (page) break;
      } catch (error) {
        if (
          error.cause?.code !== "ECONNREFUSED" &&
          error.name !== "TimeoutError"
        )
          throw error;
      }
      await delay(200);
    }
    if (!page) throw new Error(`Packaged application did not start: ${output}`);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, "open", { signal: AbortSignal.timeout(10000) });
    let ready = false;
    let commandId = 0;
    while (Date.now() < startupDeadline) {
      const result = await command(socket, ++commandId, "Runtime.evaluate", {
        expression:
          "document.readyState === 'complete' && !!document.querySelector('button')",
        returnByValue: true,
      });
      if (result.result?.value === true) {
        ready = true;
        break;
      }
      if (exit)
        throw new Error(
          `Packaged application exited ${JSON.stringify(exit)}: ${output}`,
        );
      await delay(200);
    }
    if (!ready) throw new Error(`Packaged application did not load: ${output}`);
    await exercise(new URL(page.url).origin);
    socket.send(JSON.stringify({ id: 1000, method: "Page.close" }));
    for (let attempt = 0; attempt < 150 && !exit; attempt++) await delay(200);
    if (!exit || exit.code !== 0)
      throw new Error(
        `Packaged application did not shut down cleanly: ${output}`,
      );
  } finally {
    socket?.close();
    if (!exit) await stopFailedApplication(child, () => Boolean(exit));
  }
}

/**
 * Request a JSON API response from the isolated application.
 * @param {string} origin Application origin.
 * @param {string} path API path.
 * @param {RequestInit & { status?: number }} options Request and expected status.
 * @returns {Promise<any>} Parsed JSON response.
 */
async function api(origin, path, options = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, options.status ?? 200, path);
  return response.json();
}

const directory = await mkdtemp(join(tmpdir(), "inventory-packaged-"));
try {
  let saved;
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQYlWNg6EgjjBhGvCIAduVZQWDem3YAAAAASUVORK5CYII=",
    "base64",
  );
  await runApplication(first, directory, async (origin) => {
    const inventory = await api(origin, "/inventories", {
      method: "POST",
      status: 201,
      body: JSON.stringify({ name: "Packaged synthetic" }),
    });
    const field = await api(origin, `/inventories/${inventory.id}/fields`, {
      method: "POST",
      status: 201,
      body: JSON.stringify({ name: "Image", field_type: "attachment" }),
    });
    const path = `/inventories/${inventory.id}/fields/${field.id}/attachments`;
    const file = await api(origin, path, {
      method: "POST",
      status: 201,
      body: image,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "test.png",
      },
    });
    await api(origin, `/inventories/${inventory.id}/items`, {
      method: "POST",
      status: 201,
      body: JSON.stringify({
        values: [{ field_id: field.id, value: [file.id] }],
      }),
    });
    const preview = await fetch(`${origin}/api${path}/${file.id}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/webp");
    const backup = await api(origin, "/backups", {
      method: "POST",
      status: 201,
    });
    saved = { inventory, field, file, backup };
  });
  await runApplication(second, directory, async (origin) => {
    assert.equal((await api(origin, "/inventories"))[0].id, saved.inventory.id);
    const path = `/inventories/${saved.inventory.id}/fields/${saved.field.id}/attachments/${saved.file.id}/download`;
    const response = await fetch(`${origin}/api${path}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    assert.ok(
      (await api(origin, "/backups")).some(
        (item) => item.filename === saved.backup.filename,
      ),
    );
  });
  console.log(
    "PASS: packaged startup, native image preview, attachment, backup, clean shutdown and restart.",
  );
  if (second !== first)
    console.log(
      "PASS: data survives replacement with the second packaged application.",
    );
} finally {
  await rm(directory, { recursive: true, force: true });
}
