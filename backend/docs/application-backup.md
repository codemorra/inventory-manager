# Application backup format

Data backups use a versioned ZIP format distinct from the single-inventory exchange format. Version 1 contains `backup.json`, `inventory.db` and `attachments/<attachment-id>.blob` for each active managed attachment, including unclaimed uploads. SQLite retains all tables, identities, timestamps, revisions, templates, views, automatic-number counters and deletion tombstones. Deleted attachment bodies and unreferenced files are excluded; their retained database records remain subject to ordinary cleanup.

## Manifest

`backup.json` identifies `format: "inventory-manager-backup"`, `version: 1`, a UUID `id`, UTC `created_at`, `kind` (`manual`, `automatic` or `pre-restore`) and a `files` array. Each file entry declares its exact archive `path`, nonnegative safe-integer `byte_size` and lowercase hexadecimal SHA-256 digest. Paths must be unique; exactly one database is required. The manifest does not list itself. The initial implementation creates manual backups only; automatic scheduling and restoration follow separately.

SQLite's backup API incorporates committed WAL content into the self-contained snapshot.

## Creation and validation

`POST /backups` creates a manual backup in the current configured backup directory and returns HTTP 201 with `id`, generated `filename`, `created_at`, `kind` and compressed `byte_size`. The response uses `Cache-Control: no-store` and exposes no filesystem path. No body is required. The runtime holds new requests, drains existing requests/streams and tracked asynchronous work, and suspends scheduled file cleanup until the operation finishes. Backups and live storage relocation share this exclusive runtime coordination. A client disconnect does not cancel an accepted durable backup operation.

Creation snapshots SQLite into private temporary storage and verifies managed originals against their database sizes and available SHA-256 hashes. A private directory beside the destination holds the ZIP, permitting the data, temporary and backup directories to reside on separate filesystems. The completed archive is read back: exact entries, supported unencrypted ZIP Store/Deflate layout, regular file types, actual sizes, CRCs, SHA-256 hashes, SQLite integrity/foreign keys and attachment metadata must all pass. Archive entry names never become extraction paths; only the database is extracted to a generated private filename for verification. Attachments are verified as streams without retaining their bodies in memory or extracting duplicate copies.

Only a successfully verified ZIP is atomically renamed to a generated timestamp/UUID filename in the backup directory. Failure preserves application data and existing backups and removes private workspaces. An interrupted process may leave private `backup-XXXXXX` directories in temporary storage or `.backup-XXXXXX` directories in backup storage; startup reconciles these while holding the application lifetime lock. Unrelated names and completed backups are preserved. Source attachments must be regular files; links and special files are rejected.

Metadata is bounded to 64 MiB and archives to 524,290 entries, matching the existing archive processing bounds. These bounds do not impose a per-attachment or total ZIP byte-size limit. Additional disk space is required for the SQLite snapshot, its verification copy and the compressed backup. New requests remain queued during backup creation and verification.

Validation failures return 422 `invalid_backup_archive`; an unavailable exclusive operation returns 409 `backup_conflict`. Unexpected storage failures return 500. Waiting requests resume after either success or failure.

## Listing and download

`GET /backups` lists regular files matching the application's timestamp/UUID backup naming convention in the active backup directory, ordered by filename from newest to oldest. Each entry contains `filename`, compressed `byte_size` and `metadata` with `id`, `created_at` and `kind`. Listing reads and validates bounded manifest metadata without decompressing the database or attachment bodies. An unreadable manifest produces `metadata: null` for that entry, preserving access to other backups. Private publication directories, symbolic links, directories and unrelated filenames are ignored. API responses expose archive basenames rather than local filesystem paths.

`GET /backups/{filename}/download` streams the selected regular archive as `application/zip`, with attachment disposition, exact `Content-Length`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. `HEAD` returns the download headers without transmitting the body. Downloads are repeatable and preserve the archive. Invalid names, missing files and symbolic links return 404 `backup_not_found`. Requests and download streams participate in the existing runtime activity tracking, so storage relocation waits for active downloads to finish.

Settings > Backups loads the list when expanded and offers manual creation, refresh and native browser downloads. Creation temporarily disables competing settings operations and dialog dismissal while awaiting its result. A successful creation remains visible if a subsequent list refresh fails. An uncertain creation response requires refreshing the catalog before another creation attempt.
