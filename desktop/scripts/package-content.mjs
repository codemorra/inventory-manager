import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Hash a file without loading the complete runtime binary into memory.
 * @param {string} path File to hash.
 * @returns {Promise<string>} SHA-256 digest.
 */
async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Check every prepared runtime file against the unpacked application.
 * @param {string} source Prepared runtime directory.
 * @param {string} destination Packaged runtime directory.
 * @returns {Promise<void>} Resolves when all files are present and unchanged.
 * @throws {Error} When a file is missing, changed or unsupported.
 */
export async function verifyPackageFiles(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const original = join(source, entry.name);
    const packaged = join(destination, entry.name);
    if (entry.isDirectory()) {
      await verifyPackageFiles(original, packaged);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const originalStat = await stat(original);
      if (!originalStat.isFile())
        throw new Error(`Unsupported runtime link: ${original}`);
      if ((await fileHash(original)) !== (await fileHash(packaged)))
        throw new Error(`Packaged runtime file differs: ${packaged}`);
    } else {
      throw new Error(`Unsupported runtime entry: ${original}`);
    }
  }
}
