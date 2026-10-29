import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createUpdateChecker } from "../src/updates/service.js";
import { createApp } from "../src/app.js";
import { createServices } from "../src/services.js";
import { openDatabase } from "../src/db/connection.js";
import { APP_VERSION } from "../src/generated/app-version.js";

/**
 * Create an isolated GitHub response without any real network request.
 * @param data The JSON body to serve.
 * @param status The HTTP response status.
 * @param headers Optional GitHub response headers.
 * @returns A consumable response fixture.
 */
function response(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * Describe an ordinary published release with an intentionally untrusted HTML URL.
 * @param tag The release's version tag.
 * @returns GitHub-shaped release metadata.
 */
function release(tag = "v1.10.0") {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: "https://example.com/untrusted",
  };
}

for (const [installed, published, expected] of [
  ["1.9.0", "v1.10.0", "available"],
  ["1.0.9", "v1.0.10", "available"],
  ["1.99.99", "v2.0.0", "available"],
  ["0.0.0", "v1.0.0", "available"],
  ["1.10.0", "v1.9.0", "current"],
  ["2.0.0", "v1.99.99", "current"],
  ["1.10.0", "v1.10.0", "current"],
  ["1.0.9007199254740992", "v1.0.9007199254740993", "available"],
] as const) {
  test(`compares ${installed} against ${published} numerically`, async () => {
    const check = createUpdateChecker(
      async () => response(release(published)),
      installed,
    );
    assert.deepEqual(await check(), {
      status: expected,
      current_version: installed,
      latest_version: published.slice(1),
      release_url: `https://github.com/codemorra/inventory-manager/releases/tag/${published}`,
    });
  });
}

for (const tag of [
  "1.2.3",
  "V1.2.3",
  "v1",
  "v1.2",
  "v1.2.3.4",
  "v1.2.3-beta.1",
  "v1.2.3+build",
  " v1.2.3",
  "v1.2.3\n",
  "release-1.2.3",
  "v1.2.x",
  "",
]) {
  test(`rejects unsupported GitHub tag ${JSON.stringify(tag)}`, async () => {
    const check = createUpdateChecker(
      async () => response(release(tag)),
      "1.0.0",
    );
    assert.equal((await check()).status, "failed");
  });
}

for (const installed of ["1", "1.2", "v1.2.3", "1.2.3-beta", "1.2.3\n"]) {
  test(`rejects unsupported installed version ${JSON.stringify(installed)}`, async () => {
    let calls = 0;
    const check = createUpdateChecker(async () => {
      calls++;
      return response(release());
    }, installed);
    assert.equal((await check()).status, "failed");
    assert.equal(calls, 0);
  });
}

test("checks only the fixed repository with a deadline and identifies the application", async () => {
  const calls: { url: unknown; options: RequestInit | undefined }[] = [];
  const check = createUpdateChecker(async (url, options) => {
    calls.push({ url, options });
    return response(release());
  }, "1.9.0");
  assert.equal(calls.length, 0);
  await check();
  assert.equal(
    calls[0]!.url,
    "https://api.github.com/repos/codemorra/inventory-manager/releases/latest",
  );
  assert.deepEqual(calls[0]!.options?.headers, {
    Accept: "application/vnd.github+json",
    "User-Agent": "InventoryManager/1.9.0",
    "X-GitHub-Api-Version": "2026-03-10",
  });
  assert(calls[0]!.options?.signal instanceof AbortSignal);
  assert.equal(calls[0]!.options?.redirect, "error");
});

test("distinguishes no public release from a missing or inaccessible repository", async () => {
  for (const [repositoryStatus, expected] of [
    [200, "no_release"],
    [404, "failed"],
    [500, "failed"],
  ] as const) {
    const paths: string[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const check = createUpdateChecker(async (url, options) => {
      paths.push(String(url));
      signals.push(options?.signal);
      return response({}, paths.length === 1 ? 404 : repositoryStatus);
    }, "0.0.0");
    assert.equal((await check()).status, expected);
    assert.deepEqual(paths, [
      "https://api.github.com/repos/codemorra/inventory-manager/releases/latest",
      "https://api.github.com/repos/codemorra/inventory-manager",
    ]);
    assert.equal(signals[0], signals[1]);
  }
});

test("reports timeouts, transport failures, invalid JSON and malformed release data", async () => {
  for (const failure of [
    new DOMException("Timeout", "TimeoutError"),
    new TypeError("Offline"),
  ]) {
    const check = createUpdateChecker(async () => {
      throw failure;
    }, "1.0.0");
    assert.equal((await check()).status, "failed");
  }
  const invalidJson = createUpdateChecker(
    async () => new Response("invalid JSON"),
    "1.0.0",
  );
  assert.equal((await invalidJson()).status, "failed");
  for (const data of [
    null,
    [],
    {},
    { ...release(), tag_name: 123 },
    { ...release(), draft: true },
    { ...release(), prerelease: true },
  ]) {
    const check = createUpdateChecker(async () => response(data), "1.0.0");
    assert.equal((await check()).status, "failed");
  }
  for (const status of [403, 500, 503]) {
    const check = createUpdateChecker(
      async () => response({}, status),
      "1.0.0",
    );
    assert.equal((await check()).status, "failed");
  }
});

test("honors GitHub rate-limit deadlines without making more requests during the pause", async (context) => {
  const initialTime = Date.now();
  let now = initialTime;
  context.mock.method(Date, "now", () => now);
  for (const [status, headers] of [
    [429, { "retry-after": "120" }],
    [
      403,
      {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.ceil(now / 1000) + 120),
      },
    ],
    [403, { "retry-after": new Date(now + 120_000).toUTCString() }],
    [429, {}],
  ] as const) {
    now = initialTime;
    let calls = 0;
    const check = createUpdateChecker(async () => {
      calls++;
      return calls === 1 ? response({}, status, headers) : response(release());
    }, "1.0.0");
    assert.equal((await check()).status, "rate_limited");
    assert.equal((await check()).status, "rate_limited");
    assert.equal(calls, 1);
    now += 121_000;
    assert.equal((await check()).status, "available");
    assert.equal(calls, 2);
  }
});

test("handles rate limiting during the repository availability check", async () => {
  let calls = 0;
  const check = createUpdateChecker(async () => {
    calls++;
    return response({}, calls === 1 ? 404 : 429);
  }, "0.0.0");
  assert.equal((await check()).status, "rate_limited");
  assert.equal((await check()).status, "rate_limited");
  assert.equal(calls, 2);
});

test("joins simultaneous checks and allows another explicit check after completion", async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  let calls = 0;
  const check = createUpdateChecker(async () => {
    calls++;
    return calls === 1 ? pending : response(release());
  }, "1.0.0");
  const first = check();
  const second = check();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve(response(release()));
  assert.equal((await first).status, "available");
  await second;
  assert.equal((await check()).status, "available");
  assert.equal(calls, 2);
});

test("the application exposes an uncached manual check using the compiled version", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response(release("v999.0.0"));
  });
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const errors: unknown[] = [];
  const app = createApp(
    { error: (...args) => errors.push(args) },
    createServices(connection.db),
  );
  assert.equal(calls, 0);
  const result = await request(app).get("/application-update").expect(200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(result.body, {
    current_version: APP_VERSION,
    status: "available",
    latest_version: "999.0.0",
    release_url:
      "https://github.com/codemorra/inventory-manager/releases/tag/v999.0.0",
  });
  assert.equal(calls, 1);
  assert.deepEqual(errors, []);
});
