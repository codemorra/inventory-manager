import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";
import { describeFile, verifyBackup } from "./archive.js";
import type { createBackupCatalog } from "./catalog.js";
import { invalidBackup, type BackupManifest } from "./manifest.js";
import { inspectRestoreDatabase } from "./restore-database.js";
import { readRestoreReceipt, type RestoreReceipt } from "./restore-storage.js";

const lifetime = 30 * 60 * 1000;
interface Session {
  workspace: string;
  manifest: BackupManifest;
  digest: string;
  expires: number;
  busy: boolean;
  counts: ReturnType<typeof inspectRestoreDatabase>;
  completed?: RestoreReceipt;
}

/**
 * Create the stable error for expired, canceled or unknown restore previews.
 * @returns A backup_restore_not_found domain error for the caller to throw.
 */
function missingRestore() {
  return new DomainError(
    "backup_restore_not_found",
    "The restore preview is unavailable. Select the backup again.",
  );
}

/**
 * Own private, expiring restore previews and immutable selected archive identities.
 * @param config Active temporary storage and the fixed application configuration directory.
 * @param catalog Managed backup downloads used to copy selected stored archives.
 * @returns Preparation, validation, receipt and cleanup operations.
 */
export function createRestoreService(
  config: AppConfig,
  catalog: ReturnType<typeof createBackupCatalog>,
) {
  const sessions = new Map<string, Session>();
  const active = new Set<string>();
  /**
   * Retrieve a live preview without reviving expired or canceled selections.
   * @param id The opaque selection identity.
   * @returns The live preview session.
   * @throws {DomainError} When the selection is unavailable or expired.
   */
  function get(id: string) {
    const session = sessions.get(id);
    if (!session || (!session.busy && session.expires <= Date.now()))
      throw missingRestore();
    return session;
  }
  /**
   * Build the user-facing summary without exposing staging paths.
   * @param id The opaque selection identity.
   * @param session The validated private snapshot.
   * @returns Backup metadata, counts, expiry and preview status.
   */
  function summary(id: string, session: Session) {
    return {
      id,
      status: session.completed
        ? ("completed" as const)
        : session.busy
          ? ("restoring" as const)
          : ("ready" as const),
      backup: {
        id: session.manifest.id,
        created_at: session.manifest.created_at,
        kind: session.manifest.kind,
      },
      counts: session.counts,
      attachment_bytes: session.manifest.files
        .filter((file) => file.path.startsWith("attachments/"))
        .reduce((total, file) => total + file.byte_size, 0),
      expires_at: new Date(session.expires).toISOString(),
      receipt: session.completed ?? null,
    };
  }
  /**
   * Remove a private workspace while preserving retryable cleanup ownership on failure.
   * @param workspace The explicitly owned preview or verification directory.
   * @returns Completion once its files have been removed.
   * @throws {Error} When temporary storage cannot be cleaned.
   */
  async function dispose(workspace: string) {
    await rm(workspace, { recursive: true, force: true });
    active.delete(workspace);
  }
  return {
    /**
     * Copy and fully validate an archive before offering it for confirmation.
     * @param source The original uploaded or managed archive stream.
     * @param signal Optional cancellation before confirmation.
     * @returns A checked restore summary with an expiring opaque identity.
     * @throws {Error} When copying, validation or cancellation prevents preparation.
     */
    async prepare(source: Readable, signal?: AbortSignal) {
      const workspace = await mkdtemp(
        join(config.tempDirectory, "restore-preview-"),
      );
      active.add(workspace);
      try {
        const archive = join(workspace, "backup.zip");
        await pipeline(
          source,
          createWriteStream(archive, { flags: "wx", mode: 0o600, flush: true }),
          signal ? { signal } : {},
        );
        signal?.throwIfAborted();
        const manifest = await verifyBackup(archive, workspace, false, signal);
        const counts = inspectRestoreDatabase(join(workspace, "verified.db"));
        const digest = (await describeFile(archive, "backup.zip")).sha256;
        signal?.throwIfAborted();
        const id = randomUUID();
        const session: Session = {
          workspace,
          manifest,
          digest,
          counts,
          expires: Date.now() + lifetime,
          busy: false,
        };
        sessions.set(id, session);
        return summary(id, session);
      } catch (error) {
        await dispose(workspace);
        throw error;
      }
    },
    /**
     * Prepare an independent private copy of a selected managed backup.
     * @param filename The generated basename shown in the backup list.
     * @param signal Optional cancellation while copying or validating.
     * @returns A checked restore summary, independent of later archive deletion or relocation.
     * @throws {Error} When the selected backup is unavailable or invalid.
     */
    async prepareStored(filename: string, signal?: AbortSignal) {
      const backup = await catalog.download(filename);
      try {
        return await this.prepare(backup.stream, signal);
      } finally {
        backup.stream.destroy();
      }
    },
    /**
     * Recover confirmation status, including the latest durable receipt after restart.
     * @param id The original preview or confirmation identity.
     * @returns Current preview status or a successful restore receipt.
     * @throws {DomainError} When neither a live session nor a matching receipt exists.
     */
    async read(id: string) {
      const receipt = await readRestoreReceipt(config);
      if (receipt?.id === id)
        return { id, status: "completed" as const, receipt };
      const session = get(id);
      if (session.completed)
        return { id, status: "completed" as const, receipt: session.completed };
      return summary(id, session);
    },
    /**
     * Revalidate the immutable selection into a fresh private extraction before activation.
     * @param id The explicitly confirmed preview identity.
     * @returns Checked database/attachment staging and an owned disposal callback.
     * @throws {Error} When the selection changed or cannot be validated safely.
     */
    async checked(id: string) {
      const session = get(id);
      if (session.busy || session.completed)
        throw new DomainError(
          "backup_conflict",
          "This restore has already started.",
        );
      session.busy = true;
      const workspace = await mkdtemp(
        join(config.tempDirectory, "restore-check-"),
      ).catch((error: unknown) => {
        session.busy = false;
        throw error;
      });
      active.add(workspace);
      try {
        const path = join(session.workspace, "backup.zip");
        if ((await describeFile(path, "backup.zip")).sha256 !== session.digest)
          throw invalidBackup("The selected archive has changed.");
        const manifest = await verifyBackup(path, workspace, true);
        if (JSON.stringify(manifest) !== JSON.stringify(session.manifest))
          throw invalidBackup("The selected backup manifest has changed.");
        inspectRestoreDatabase(join(workspace, "verified.db"));
        return { workspace, manifest, dispose: () => dispose(workspace) };
      } catch (error) {
        session.busy = false;
        await dispose(workspace);
        throw error;
      }
    },
    /**
     * Retain a committed result and invalidate the consumed preview body.
     * @param id The confirmed session identity.
     * @param receipt The successfully journaled activation result.
     * @returns Completion after best-effort removal of its copied archive.
     */
    async complete(id: string, receipt: RestoreReceipt) {
      const session = sessions.get(id);
      if (session) {
        session.completed = receipt;
        session.busy = false;
        session.expires = Date.now() + lifetime;
        await dispose(session.workspace).catch(() => {});
      }
    },
    /**
     * Allow an explicitly retried confirmation after a safely rolled-back attempt.
     * @param id The session whose attempt has settled without activation.
     * @returns No value; the validated selection remains available until expiry.
     */
    release(id: string) {
      const session = sessions.get(id);
      if (session) session.busy = false;
    },
    /**
     * Cancel a preview without interfering with an active or completed restoration.
     * @param id The selection to discard.
     * @returns Completion after removing the unused copied archive.
     * @throws {DomainError} When restoration of this selection is active.
     */
    async discard(id: string) {
      const session = sessions.get(id);
      if (!session) return;
      if (session.busy)
        throw new DomainError(
          "backup_conflict",
          "The restore is already running.",
        );
      sessions.delete(id);
      await dispose(session.workspace);
    },
    /**
     * Reconcile expired sessions and abandoned private restore workspaces.
     * @param now The cleanup time, injectable for deterministic lifecycle tests.
     * @returns Completion after expired and abandoned files have been removed.
     * @throws {Error} When temporary storage cannot be inspected or cleaned.
     */
    async cleanup(now = Date.now()) {
      for (const [id, session] of sessions)
        if (!session.busy && session.expires <= now) {
          sessions.delete(id);
          await dispose(session.workspace);
        }
      for (const name of await readdir(config.tempDirectory)) {
        if (!/^restore-(preview|check)-[a-zA-Z0-9]{6}$/.test(name)) continue;
        const path = join(config.tempDirectory, name);
        if (active.has(path)) continue;
        const details = await lstat(path);
        if (
          details.isDirectory() &&
          details.mtimeMs < now - 24 * 60 * 60 * 1000
        )
          await dispose(path);
      }
    },
  };
}
