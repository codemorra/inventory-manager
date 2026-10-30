import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRuntime } from "./prepare.mjs";

export const nodeVersion = "v24.22.2";

const distributions = {
  linux: {
    archive: `node-${nodeVersion}-linux-x64.tar.gz`,
    checksum:
      "361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9",
    executable: "bin/node",
    npmDirectory: "lib/node_modules/npm",
  },
  win32: {
    archive: `node-${nodeVersion}-win-x64.zip`,
    checksum:
      "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2",
    executable: "node.exe",
    npmDirectory: "node_modules/npm",
  },
};

/**
 * Select the official Node distribution for the current build platform.
 * @param {NodeJS.Platform} platform Host operating system.
 * @param {string} arch Host architecture.
 * @returns {{ archive: string, checksum: string, executable: string, npmDirectory: string }} Distribution metadata.
 * @throws {Error} When the host is not a supported x64 platform.
 */
export function nodeDistribution(platform, arch) {
  if (arch !== "x64" || (platform !== "linux" && platform !== "win32"))
    throw new Error("Desktop builds require x64 Linux or Windows.");
  return distributions[platform];
}

/**
 * Download and verify an official Node distribution.
 * @param {{ archive: string, checksum: string }} distribution Distribution metadata.
 * @param {typeof fetch} request HTTP request implementation.
 * @returns {Promise<Uint8Array>} Verified archive bytes.
 * @throws {Error} When the download or checksum verification fails.
 */
export async function downloadNode(distribution, request = fetch) {
  const url = `https://nodejs.org/dist/${nodeVersion}/${distribution.archive}`;
  const response = await request(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok)
    throw new Error(`Node download failed: ${url} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== distribution.checksum)
    throw new Error(
      `Node download checksum mismatch: ${distribution.archive}.`,
    );
  return bytes;
}

/**
 * Extract Node, npm and the Node license using the host's tar command.
 * @param {string} archive Archive path.
 * @param {string} destination Extraction directory.
 * @param {{ archive: string, executable: string, npmDirectory: string }} distribution Distribution metadata.
 * @returns {Promise<void>} Resolves after successful extraction.
 * @throws {Error} When tar cannot extract the required files.
 */
export function extractNode(archive, destination, distribution) {
  const prefix = distribution.archive.replace(/\.tar\.gz$|\.zip$/, "");
  const args = [
    "-xf",
    archive,
    "-C",
    destination,
    "--strip-components=1",
    `${prefix}/${distribution.executable}`,
    `${prefix}/LICENSE`,
    `${prefix}/${distribution.npmDirectory}`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Node extraction failed (${signal ?? code}).`));
    });
  });
}

/**
 * Prepare the self-contained runtime used by a local desktop build.
 * @returns {Promise<string>} The prepared runtime directory.
 * @throws {Error} When download, extraction or application preparation fails.
 */
export async function prepareBuildRuntime() {
  const distribution = nodeDistribution(process.platform, process.arch);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const runtime = join(root, ".local/desktop-build-runtime");
  await mkdir(runtime, { recursive: true });
  const temporary = await mkdtemp(join(runtime, ".node-"));
  const extracted = join(temporary, "extracted");
  try {
    const bytes = await downloadNode(distribution);
    const archive = join(temporary, distribution.archive);
    await writeFile(archive, bytes);
    await mkdir(extracted);
    await extractNode(archive, extracted, distribution);
    const destination = join(temporary, "node");
    const executable = join(destination, distribution.executable);
    await mkdir(dirname(executable), { recursive: true });
    await cp(join(extracted, distribution.executable), executable);
    await cp(join(extracted, "LICENSE"), join(destination, "LICENSE"));
    const nodeDirectory = join(runtime, "node");
    await rm(nodeDirectory, { recursive: true, force: true });
    await rename(destination, nodeDirectory);
    return await prepareRuntime({
      directory: runtime,
      nodeExecutable: join(nodeDirectory, distribution.executable),
      nodeVersion,
      npmExecutable: join(
        extracted,
        distribution.npmDirectory,
        "bin/npm-cli.js",
      ),
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await prepareBuildRuntime();
