import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { connectBackend } from "../src/backend-controller.js";

class Child extends EventEmitter {
  messages: unknown[] = [];
  /**
   * Record parent commands without starting a process.
   * @param message The command under test.
   * @param callback Report command delivery to the parent controller.
   * @returns Whether the command was accepted.
   */
  send(message: unknown, callback: (error: Error | null) => void) {
    this.messages.push(message);
    callback(null);
    return true;
  }
}

test("readiness comes from the child's actual port and stop waits for exit exactly once", async () => {
  const child = new Child();
  const unexpected: Error[] = [];
  const backend = connectBackend(child, (error) => unexpected.push(error));
  child.emit("message", { type: "ready", port: 32123 });
  assert.equal(await backend.origin, "http://127.0.0.1:32123");
  const stop = backend.stop();
  assert.equal(backend.stop(), stop);
  assert.deepEqual(child.messages, [{ type: "stop" }]);
  let stopped = false;
  void stop.then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  child.emit("exit", 0);
  await stop;
  assert.deepEqual(unexpected, []);
});

test("startup failures and unexpected runtime exits are reported", async () => {
  const failed = new Child();
  const startup = connectBackend(failed, () => assert.fail("not ready"));
  failed.emit("message", { type: "failed", message: "Database unavailable" });
  await assert.rejects(startup.origin, /Database unavailable/);
  failed.emit("exit", 1);
  await assert.rejects(startup.stop(), /exited/);
  const child = new Child();
  const errors: Error[] = [];
  const backend = connectBackend(child, (error) => errors.push(error));
  child.emit("message", { type: "ready", port: 32123 });
  await backend.origin;
  child.emit("exit", 1);
  assert.equal(errors.length, 1);
});

test("stopping while startup is pending releases the process instead of orphaning it", async () => {
  const child = new Child();
  const backend = connectBackend(child, () => assert.fail("requested stop"));
  const stop = backend.stop();
  child.emit("exit", 0);
  await assert.rejects(backend.origin, /exited/);
  await stop;
});

test("a missing Node executable rejects startup and stop without waiting for a nonexistent process", async () => {
  const child = new Child();
  const backend = connectBackend(child, () => assert.fail("not started"));
  child.emit("error", new Error("Node executable not found"));
  await assert.rejects(backend.origin, /executable not found/);
  await assert.rejects(backend.stop(), /exited/);
});
