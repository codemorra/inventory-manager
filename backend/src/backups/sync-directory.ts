import { open } from "node:fs/promises";

/**
 * Flush published directory entries where the runtime platform supports directory synchronization.
 * @param path The parent directory containing a newly renamed durable file.
 * @returns Completion after synchronization, tolerating unsupported Windows directory handles.
 * @throws {Error} When supported directory synchronization fails.
 */
export async function syncBackupDirectory(path: string) {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !/^(EISDIR|EPERM|EACCES|EINVAL)$/.test(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  } finally {
    await directory?.close();
  }
}
