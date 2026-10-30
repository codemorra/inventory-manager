# Application backup format

Data backups are ZIP archives containing SQLite and managed attachments. They are separate from [single-inventory archives](inventory-archive.md). For everyday backup and restore steps, see the [user guide](usage.md#backups-and-restore).

SQLite retains inventories, groups, templates, table views, revisions, automatic-number counters and deletion tombstones. File-backed settings, storage paths, automatic-backup policy/history, window state and logs are excluded. See [storage and backups](storage.md#back-up-an-installation) for a complete installation copy.

## Format

Version 1 contains `backup.json`, `inventory.db` and `attachments/<attachment-id>.blob` for each active managed attachment, including unclaimed uploads. Deleted bodies and unreferenced files are excluded.

The manifest declares `format: "inventory-manager-backup"`, `version: 1`, a UUID `id`, UTC `created_at`, `kind` (`manual`, `automatic` or `pre-restore`) and a `files` array. Each file has an exact archive `path`, nonnegative safe-integer `byte_size` and lowercase SHA-256 digest. Paths are unique; exactly one database is required. The manifest does not list itself.

SQLite's backup API includes committed WAL content in the snapshot. Manual, automatic and pre-restore backups use the same format and validation.

## Creation and validation

Creation holds new requests, drains existing requests, streams and service work, and pauses file cleanup. It shares exclusive runtime coordination with relocation and restoration. Accepted durable work continues after client disconnection.

The backend snapshots SQLite in private temporary storage and checks managed originals against stored sizes and available hashes. The ZIP is built beside its destination, then read back before publication. Validation checks exact entries, regular file types, supported unencrypted Store/Deflate layout, decompressed sizes, CRCs, SHA-256, SQLite integrity/foreign keys and attachment metadata. Archive paths are never used as extraction paths. Only the database is extracted for verification; attachment checks stream their bytes.

A verified archive is atomically published under its timestamp/UUID filename. Failures preserve existing data and archives and remove partial work. Startup reconciles abandoned private `backup-XXXXXX` temporary directories and `.backup-XXXXXX` publication directories while holding the application lock. Unrelated files are preserved; source links and special files are rejected.

Metadata is limited to 64 MiB and archives to 524,290 entries. These are processing bounds, without a per-attachment or total ZIP byte-size cap. Creation needs extra disk space for the snapshot, verification copy and compressed archive. Queued requests resume after success or failure.

## Backup endpoints

Paths below omit the `/api` prefix used by combined runtimes. Responses use `Cache-Control: no-store`.

| Endpoint                           | Behavior                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `POST /backups`                    | No body; creates an archive and returns 201 with `id`, `filename`, `created_at`, `kind` and compressed `byte_size` |
| `GET /backups`                     | Lists regular timestamp/UUID archive files, newest first                                                           |
| `GET /backups/{filename}/download` | Repeatable ZIP download with attachment disposition, content length and `nosniff`; HEAD returns headers            |
| `DELETE /backups/{filename}`       | Deletes an unused archive and returns 204                                                                          |

List entries contain `filename`, `byte_size` and manifest `metadata` (`id`, `created_at`, `kind`). Unreadable metadata becomes null without hiding the archive. Listing does not verify database or attachment bodies. Private files, links, directories and unrelated names are ignored.

Invalid download/deletion names, missing files and links return 404 `backup_not_found`. Deleting an archive with an opening/active download or pending deletion returns 409 `backup_conflict`; downloads also reject pending deletion. Stream reservations remain held until close. Archives with unreadable metadata can still be deleted explicitly.

Invalid archive data returns 422 `invalid_backup_archive`, unavailable exclusive operations return 409 `backup_conflict`, and unexpected storage failures return 500. An uncertain creation/deletion response requires refreshing the list before another attempt.

## Checked restoration

| Endpoint                             | Behavior                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `POST /backup-restores`              | Accepts JSON `{ "filename": "<listed archive>" }` or an `application/zip` upload; returns a checked preview with 201 |
| `GET /backup-restores/{id}`          | Reads preview or completion status                                                                                   |
| `DELETE /backup-restores/{id}`       | Discards an unused preview                                                                                           |
| `POST /backup-restores/{id}/confirm` | Confirms replacement of current data                                                                                 |

Preparation makes a private archive copy, validates it fully, and checks database schema and migration history against the installed application. Stored values, templates, views, revisions, lifecycle relationships, ID counters and attachment ownership must also be consistent. Previews show the source timestamp and inventory, item and attachment counts, and expire after 30 minutes.

Confirmation rechecks the selected copy's SHA-256 and extracts a fresh verified database and attachment set. After draining active work, the backend creates and verifies a `pre-restore` safety backup. Failure stops activation. Incoming files are copied and synced into owned staging directories beside the live targets, supporting separate filesystems and an independent `INVENTORY_DB_PATH`.

SQLite is checkpointed and closed. Originals are retained under private names before the replacement is published. A synced `config/.restore-journal.json` records activation; the replacement must reopen successfully before commitment. Startup resolves this journal before opening SQLite or relocating storage: pending activation restores originals, committed activation keeps the replacement and retries cleanup. Unrecognized or missing recovery files stop startup rather than creating empty storage.

The latest successful confirmation is retained in `.restore-receipt.json`, or supplied by the committed journal while cleanup is pending. Repeating it returns the same result without restoring again, including after restart. Prepared inventory import/export sessions are invalidated. Completed/cancelled previews are cleaned up; abandoned workspaces are removed after 24 hours.

Preview endpoints use `Cache-Control: no-store`. Expired/unavailable identities return 404 `backup_restore_not_found`; conflicts return 409 `backup_conflict`; invalid archives return 422 `invalid_backup_archive`. Confirmed work continues after disconnection. After an uncertain confirmation, query the same identity before retrying.

### Client generation checks

Responses expose `X-Inventory-Generation` through CORS. Clients pin the first observed generation and send it on later requests. Restoration changes this identity; writes carrying an older generation return 409 `application_data_changed`. Writes queued before restoration retain their original generation.

The frontend rejects responses from a changed generation and requires a reload after restoration, clearing cached data and editing sessions.

## Automatic backups

`config/settings.json` stores optional `backups: { frequency, retention }`. Frequency is `disabled`, `daily` or `weekly`; retention is 1–1,000. Defaults are disabled with ten retained automatic archives. Policy writes share the settings revision. Operational state lives separately in `config/.automatic-backups.json` and does not advance that revision.

Checks run at startup, every minute while the backend is open and after policy updates. Days and Monday-based weeks use the runtime's local calendar. Successful archive creation time determines its period, including across daylight-saving or calendar boundaries. Missed periods produce one backup for the current period. Manual and pre-restore backups do not satisfy the schedule.

Recorded successes survive restart and archive deletion. Changing frequency evaluates prior successes against the new period. Concurrent checks join existing work; policy is re-read after draining activity. Shutdown waits for accepted work. Creation and retention failures are reported separately and retried after five minutes; startup or a policy save can trigger an earlier retry. Disabling the schedule suspends both creation and retention.

Before creation, the ledger records the intended UUID and timestamp. Publication is synced before success is recorded. After interruption, the next check validates and adopts that exact published archive instead of creating a duplicate. Missing unpublished files permit another attempt; mismatched or damaged files are preserved. Unreadable state returns 503 `backup_schedule_unavailable`; the ledger is bounded to 16 MiB and 50,000 archive records.

Retention follows successful publication or recovery and considers only recorded automatic archives in completion order. Identity, filename, timestamp and kind are checked before deletion. Manual, pre-restore, untracked, replaced or in-use archives are preserved. Missing records are reconciled and failed cleanup is retried without revoking success or creating another backup. Reducing retention alone waits for the next success unless cleanup is already pending.

`GET /backups/schedule` returns `revision`, `policy`, `running`, `last_success`, `last_failure`, `retention_pending` and `next_retry_at`. Success includes identity, filename and creation/completion timestamps; failure identifies its time and phase. `PUT` accepts `{ "expected_revision": 0, "policy": { "frequency": "daily", "retention": 10 } }`. Stale revisions return 409 `application_settings_conflict`; invalid policy returns 422. Both use `Cache-Control: no-store`.

The frontend refreshes schedule status and archives every minute. Background refreshes preserve policy drafts; an explicit save checks the captured revision.
