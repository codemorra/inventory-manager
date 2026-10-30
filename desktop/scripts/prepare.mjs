import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const developmentRuntime = join(root, ".local/desktop-runtime");

/**
 * Run an npm command using the selected Node and npm installation.
 * @param {string[]} args Arguments passed to npm.
 * @param {NodeJS.ProcessEnv} environment Build environment, including frontend API selection.
 * @param {string} nodeExecutable Node executable used by npm and its lifecycle scripts.
 * @param {string | undefined} npmExecutable npm CLI script.
 * @returns {Promise<void>} Resolves after successful completion.
 */
export function npm(
  args,
  environment = process.env,
  nodeExecutable = process.execPath,
  npmExecutable = process.env.npm_execpath,
) {
  if (!npmExecutable) throw new Error("Run this script through npm.");
  const childEnvironment = { ...environment };
  if (nodeExecutable !== process.execPath) {
    const pathKey =
      Object.keys(childEnvironment).find(
        (key) => key.toLowerCase() === "path",
      ) ?? "PATH";
    childEnvironment[pathKey] = [
      dirname(nodeExecutable),
      childEnvironment[pathKey] ?? "",
    ].join(delimiter);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(nodeExecutable, [npmExecutable, ...args], {
      cwd: root,
      env: childEnvironment,
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
 * @param {{ directory?: string, nodeExecutable?: string, nodeVersion?: string, npmExecutable?: string }} options Runtime location and Node installation.
 * @returns {Promise<string>} The generated runtime directory.
 * @throws {Error} When dependency installation or application compilation fails.
 */
export async function prepareRuntime(options = {}) {
  const runtime = options.directory ?? developmentRuntime;
  const backend = join(runtime, "backend");
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const nodeVersion = options.nodeVersion ?? process.version;
  await mkdir(backend, { recursive: true });
  const lock = await readFile(join(root, "backend/package-lock.json"));
  const manifest = await readFile(join(root, "backend/package.json"));
  const fingerprint = createHash("sha256")
    .update(lock)
    .update(manifest)
    .update(
      `node/${nodeVersion}/${process.platform}/${process.arch}/${options.npmExecutable ? "bundled-npm" : "caller-npm"}`,
    )
    .digest("hex");
  const marker = join(runtime, "dependencies.sha256");
  const previous = await readFile(marker, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous !== fingerprint) {
    await rm(marker, { force: true });
    for (const name of ["package.json", "package-lock.json"])
      await cp(join(root, "backend", name), join(backend, name));
    await npm(
      ["--prefix", backend, "ci", "--omit=dev"],
      process.env,
      nodeExecutable,
      options.npmExecutable,
    );
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
