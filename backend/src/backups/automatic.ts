import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";
import { createSettingsService } from "../settings/service.js";
import type { BackupPolicy } from "../settings/validation.js";
import { verifyBackup } from "./archive.js";
import {
  readAutomaticState,
  writeAutomaticState,
  type AutomaticState,
  type AutomaticRecord,
  type AutomaticFailure,
} from "./automatic-state.js";
import type { createBackupCatalog } from "./catalog.js";
import { invalidBackup } from "./manifest.js";
import { syncBackupDirectory } from "./sync-directory.js";
import {
  backupFilename,
  type BackupIdentity,
  type createBackup,
} from "./service.js";

const retryDelay = 5 * 60 * 1000;
export interface AutomaticBackupOptions {
  exclusive: (work: () => Promise<void>) => Promise<boolean>;
  create: (
    identity: BackupIdentity,
  ) => Promise<Awaited<ReturnType<typeof createBackup>>>;
  now?: () => Date;
  onError: (error: unknown) => void;
}

/**
 * Derive a local calendar day or Monday-based calendar-week identity without elapsed-hour arithmetic.
 * @param now The instant interpreted in the runtime's local timezone.
 * @param frequency Daily or weekly calendar semantics.
 * @returns The local day, or the Monday beginning that local week, in YYYY-MM-DD form.
 */
export function automaticBackupPeriod(
  now: Date,
  frequency: "daily" | "weekly",
) {
  const day = new Date(now);
  if (frequency === "weekly")
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return `${day.getFullYear().toString().padStart(4, "0")}-${(day.getMonth() + 1).toString().padStart(2, "0")}-${day.getDate().toString().padStart(2, "0")}`;
}

/**
 * Determine eligibility using only successful automatic creations recorded by this installation.
 * @param policy The effective frequency and retention policy.
 * @param state Durable automatic-only success history.
 * @param now The current local calendar instant.
 * @returns Whether the current period still needs one successful automatic backup.
 */
export function automaticBackupDue(
  policy: BackupPolicy,
  state: AutomaticState,
  now: Date,
) {
  if (policy.frequency === "disabled") return false;
  const frequency = policy.frequency;
  const current = automaticBackupPeriod(now, frequency);
  return ![
    ...(state.last_success ? [state.last_success] : []),
    ...state.archives,
  ].some(
    (record) =>
      automaticBackupPeriod(new Date(record.created_at), frequency) === current,
  );
}

/**
 * Own startup/running eligibility, publication recovery, retries and automatic-only retention.
 * @param config Active paths, updated in place after a checked storage relocation.
 * @param catalog The shared catalog guarding active downloads and deletion.
 * @param options Runtime exclusivity, consistent creation, clock and error reporting.
 * @returns Policy/status API operations and a coalescing scheduler lifecycle.
 */
export function createAutomaticBackups(
  config: AppConfig,
  catalog: ReturnType<typeof createBackupCatalog>,
  options: AutomaticBackupOptions,
) {
  const settings = createSettingsService(config.settingsPath);
  const now = options.now ?? (() => new Date());
  let checking: Promise<void> | undefined;
  let stopped = false;
  let running = false;
  let nextAttempt = 0;
  let failure: AutomaticFailure | null = null;

  /**
   * Recover a known publication before permitting another automatic attempt.
   * @param state The ledger containing a durably recorded creation intent.
   * @returns Reconciled state; a published archive is adopted only after full verification.
   * @throws {Error} When the artifact or ledger cannot be safely reconciled.
   */
  async function recover(state: AutomaticState): Promise<AutomaticState> {
    if (!state.pending) return state;
    const identity = state.pending;
    const filename = backupFilename(identity);
    const path = join(config.backupsDirectory, filename);
    let workspace: string | undefined;
    try {
      let details;
      try {
        details = await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const cleared = { ...state, pending: null };
        await writeAutomaticState(config, cleared);
        return cleared;
      }
      if (!details.isFile())
        throw invalidBackup(
          "The pending automatic backup is not a regular archive.",
        );
      workspace = await mkdtemp(join(config.tempDirectory, "automatic-check-"));
      const manifest = await verifyBackup(path, workspace);
      if (
        manifest.kind !== "automatic" ||
        manifest.id !== identity.id ||
        manifest.created_at !== identity.created_at
      )
        throw invalidBackup(
          "The pending automatic backup has inconsistent metadata.",
        );
      await syncBackupDirectory(config.backupsDirectory);
      const record: AutomaticRecord = {
        ...identity,
        filename,
        completed_at: now().toISOString(),
      };
      const recovered = {
        ...state,
        pending: null,
        last_success: record,
        archives: [
          record,
          ...state.archives.filter((entry) => entry.id !== record.id),
        ],
        retention_pending: true,
        last_failure: null,
      };
      await writeAutomaticState(config, recovered);
      return recovered;
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "invalid_backup_archive"
      )
        await writeAutomaticState(config, { ...state, pending: null });
      throw error;
    } finally {
      if (workspace) await rm(workspace, { recursive: true, force: true });
    }
  }

  /**
   * Remove only excess tracked automatic archives whose current metadata still matches the ledger.
   * @param state The durable successful-creation ledger, newest completion first.
   * @param retention The number of existing automatic archives to retain.
   * @returns Updated retention state after safely deleting eligible old archives.
   * @throws {Error} When an archive is in use, unreadable, replaced or cannot be removed.
   */
  async function prune(
    state: AutomaticState,
    retention: number,
  ): Promise<AutomaticState> {
    const listed = new Map(
      (await catalog.list()).map((entry) => [entry.filename, entry]),
    );
    const absent = new Set<string>();
    const matching: AutomaticRecord[] = [];
    const errors: unknown[] = [];
    for (const record of state.archives) {
      const entry = listed.get(record.filename);
      if (!entry) {
        try {
          await lstat(join(config.backupsDirectory, record.filename));
          errors.push(
            new Error("A tracked automatic archive is not a regular file."),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            absent.add(record.id);
          else errors.push(error);
        }
      } else if (
        entry.metadata?.kind === "automatic" &&
        entry.metadata.id === record.id &&
        entry.metadata.created_at === record.created_at
      )
        matching.push(record);
      else
        errors.push(
          new Error(
            "A tracked automatic archive has unreadable or changed metadata.",
          ),
        );
    }
    for (const record of matching.slice(retention)) {
      try {
        await catalog.remove(record.filename);
        absent.add(record.id);
      } catch (error) {
        if (error instanceof DomainError && error.code === "backup_not_found")
          absent.add(record.id);
        else errors.push(error);
      }
    }
    const updated = {
      ...state,
      archives: state.archives.filter((entry) => !absent.has(entry.id)),
      retention_pending: errors.length > 0,
      last_failure: errors.length
        ? { at: now().toISOString(), stage: "retention" as const }
        : null,
    };
    await syncBackupDirectory(config.backupsDirectory);
    await writeAutomaticState(config, updated);
    if (errors.length)
      throw new AggregateError(
        errors,
        "Automatic backup retention will be retried.",
      );
    return updated;
  }

  /**
   * Recheck current policy under the runtime barrier before creating or pruning anything.
   * @returns Completion after the due attempt and its retention work have settled.
   * @throws {Error} When configuration, state, creation or retention fails.
   */
  async function check() {
    const time = now().getTime();
    if (nextAttempt && time < nextAttempt - retryDelay) nextAttempt = 0;
    if (stopped || time < nextAttempt) return;
    const policy = (await settings.readBackupPolicy()).policy;
    if (policy.frequency === "disabled") return;
    const snapshot = await readAutomaticState(config);
    if (
      !snapshot.pending &&
      !snapshot.retention_pending &&
      !automaticBackupDue(policy, snapshot, now())
    )
      return;
    await options.exclusive(async () => {
      if (stopped) return;
      let stage: AutomaticFailure["stage"] = "backup";
      try {
        const current = (await settings.readBackupPolicy()).policy;
        if (current.frequency === "disabled") return;
        running = true;
        let state = await recover(await readAutomaticState(config));
        if (automaticBackupDue(current, state, now())) {
          const identity: BackupIdentity = {
            id: randomUUID(),
            created_at: now().toISOString(),
          };
          await writeAutomaticState(config, { ...state, pending: identity });
          const artifact = await options.create(identity);
          if (
            artifact.id !== identity.id ||
            artifact.created_at !== identity.created_at ||
            artifact.filename !== backupFilename(identity) ||
            artifact.kind !== "automatic"
          )
            throw new Error("Automatic backup publication identity changed.");
          const record: AutomaticRecord = {
            ...identity,
            filename: artifact.filename,
            completed_at: now().toISOString(),
          };
          const completed = {
            ...state,
            pending: null,
            last_success: record,
            archives: [
              record,
              ...state.archives.filter((entry) => entry.id !== record.id),
            ],
            retention_pending: true,
            last_failure: null,
          };
          await writeAutomaticState(config, completed);
          state = completed;
        }
        stage = "retention";
        if (state.retention_pending) await prune(state, current.retention);
        failure = null;
        nextAttempt = 0;
      } catch (error) {
        failure = { at: now().toISOString(), stage };
        nextAttempt = now().getTime() + retryDelay;
        try {
          await writeAutomaticState(config, {
            ...(await readAutomaticState(config)),
            last_failure: failure,
          });
        } catch (stateError) {
          options.onError(stateError);
        }
        options.onError(error);
      } finally {
        running = false;
      }
    });
  }

  return {
    /**
     * Read policy and operational status without replacing captured configuration drafts.
     * @returns Shared settings revision, policy, successful automatic history and current retry status.
     * @throws {Error} When configuration or operational state is unavailable.
     */
    async read() {
      const policy = await settings.readBackupPolicy();
      const state = await readAutomaticState(config);
      return {
        ...policy,
        running,
        last_success: state.last_success,
        last_failure: failure ?? state.last_failure,
        retention_pending: state.retention_pending,
        next_retry_at:
          policy.policy.frequency !== "disabled" && nextAttempt
            ? new Date(nextAttempt).toISOString()
            : null,
      };
    },
    /**
     * Save an explicitly edited schedule at the shared configuration revision.
     * @param input The captured revision and complete daily/weekly retention policy.
     * @returns The accepted policy and latest operational status.
     * @throws {Error} When validation, revision checks or persistence fail.
     */
    async update(input: unknown) {
      await settings.updateBackupPolicy(input);
      nextAttempt = 0;
      return this.read();
    },
    /**
     * Coalesce overlapping startup, timer and settings-triggered eligibility checks.
     * @returns The current check, including any guarded creation and retention work.
     */
    tick(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (checking) return checking;
      const task = check().catch((error: unknown) => {
        failure = { at: now().toISOString(), stage: "backup" };
        nextAttempt = now().getTime() + retryDelay;
        options.onError(error);
      });
      checking = task;
      void task.then(() => {
        if (checking === task) checking = undefined;
      });
      return task;
    },
    /**
     * Stop accepting checks and join any already accepted durable operation.
     * @returns Completion after the active scheduler work has settled.
     */
    async stop() {
      stopped = true;
      await checking;
    },
  };
}
