import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runtime = join(root, ".local/desktop-runtime");
const backend = join(runtime, "backend");

/**
 * Run an npm command with the same Node/npm installation as the caller.
 * @param {string[]} args Arguments passed to npm.
 * @param {NodeJS.ProcessEnv} environment Build environment, including frontend API selection.
 * @returns {Promise<void>} Resolves after successful completion.
 */
export function npm(args, environment = process.env) {
  if (!process.env.npm_execpath)
    throw new Error("Run this script through npm.");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`npm ${args.join(" ")} failed (${signal ?? code}).`));
    });
  });
}

/**
 * Prepare isolated Node dependencies and copy freshly compiled application resources.
 * @returns {Promise<string>} The generated runtime directory.
 * @throws {Error} When dependency installation or application compilation fails.
 */
export async function prepareRuntime() {
  await mkdir(backend, { recursive: true });
  const lock = await readFile(join(root, "backend/package-lock.json"));
  const fingerprint = createHash("sha256")
    .update(lock)
    .update(
      `node/${process.version}/${process.versions.modules}/${process.platform}/${process.arch}`,
    )
    .digest("hex");
  const marker = join(runtime, "dependencies.sha256");
  const previous = await readFile(marker, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous !== fingerprint) {
    for (const name of ["package.json", "package-lock.json"])
      await cp(join(root, "backend", name), join(backend, name));
    await npm(["--prefix", backend, "ci", "--omit=dev"]);
    await writeFile(marker, fingerprint);
  }
  await npm(["--prefix", "backend", "run", "build"]);
  await npm(["--prefix", "frontend", "run", "build"], {
    ...process.env,
    VITE_API_BASE_URL: "/api",
  });
  await npm(["--prefix", "desktop", "run", "build"]);
  for (const path of [
    join(backend, "dist"),
    join(backend, "drizzle"),
    join(runtime, "frontend/dist"),
  ])
    await rm(path, { recursive: true, force: true });
  await cp(join(root, "backend/dist"), join(backend, "dist"), {
    recursive: true,
  });
  await cp(join(root, "backend/drizzle"), join(backend, "drizzle"), {
    recursive: true,
  });
  await mkdir(join(runtime, "frontend"), { recursive: true });
  await cp(join(root, "frontend/dist"), join(runtime, "frontend/dist"), {
    recursive: true,
  });
  return runtime;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareRuntime();
