# Inventory Manager backend

Express/TypeScript with Drizzle and SQLite. Requires Node.js 24 or later.

## Development

Run from `backend/`:

```bash
npm ci
npm run dev
```

`better-sqlite3` is a native dependency; its installation script must run.
Building it from source requires C/C++ build tools and Node headers.

For the compiled backend:

```bash
npm run build
npm start
```

The default address is `http://127.0.0.1:8000`. `/health` checks readiness;
`/docs`, `/redoc`, and `/openapi.json` provide API documentation.
Update `src/openapi.json` when routes or DTOs change.

## Configuration

Optionally copy `.env.example` to `.env`. Development, start, and migration commands
load it automatically; process environment variables take precedence.

| Variable              | Default                                           |
| --------------------- | ------------------------------------------------- |
| `INVENTORY_DATA_DIR`  | Repository-relative `InventoryData/` storage root |
| `INVENTORY_DB_PATH`   | `<storage root>/data/inventory.db`                |
| `INVENTORY_HOST`      | `127.0.0.1`                                       |
| `INVENTORY_PORT`      | `8000`                                            |
| `INVENTORY_LOG_LEVEL` | `INFO`                                            |

Storage overrides must be absolute paths; `~/` is supported. `INVENTORY_DATA_DIR` selects the complete storage root. Runtime layout: `config/settings.json`, `data/inventory.db`, `data/attachments/`, `backups/`, `logs/`, and `temp/`. Server startup and manual database migration resolve the settings file before creating data/backup directories or opening SQLite. They initialize the selected directories and create a version-1 settings document only when missing; existing settings/data are preserved. The settings API supplies file-backed preferences to the frontend. An explicit `INVENTORY_DB_PATH` takes precedence over the database location selected through the settings file.

### Stored locations

The fixed `<storage root>/config/settings.json` may include a `storage` object alongside `version`, `revision` and `preferences`:

```json
{
  "version": 1,
  "storage": {
    "dataDirectory": "/absolute/path/to/inventory-data",
    "backupsDirectory": "/absolute/path/to/inventory-backups"
  }
}
```

Both entries are optional; omitted values use the layout defaults above. Absolute native Windows/Linux paths and `~/` are supported. `dataDirectory` contains `inventory.db` and `attachments/`; configuration, logs and temporary files remain at the fixed application root. Data, backup, configuration, log and temporary directories must not overlap, including through symbolic links. The database cannot be placed inside backup, configuration, log, temporary or attachment storage. Invalid settings or overlapping locations stop startup without rewriting the settings file. Preference responses exclude filesystem locations, and preference writes preserve stored locations.

Settings > Storage locations shows the active directories and accepts absolute data/backup destinations directly, without adding another application directory. Destination directories must be absent or empty and cannot overlap active or fixed locations. Use default only fills the corresponding path input; confirming applies the checked move without restarting the application. A separate `INVENTORY_DB_PATH` disables data relocation in the interface while still allowing backup relocation.

`GET /storage-locations` returns the shared settings revision, active paths, default data/backup paths, `dataMovable`, recovery `pending` destination paths or null, `cleanupPending` and `moveFailed`. `PUT` takes `expected_revision`, `dataDirectory` and `backupsDirectory` and applies the live move; `DELETE` takes `expected_revision` to cancel an unexecuted recovery plan. These responses use `Cache-Control: no-store`. Stale settings revisions return 409 `application_settings_conflict`; an existing plan, pending cleanup or explicit data override returns 409 `storage_location_conflict`; invalid, occupied or overlapping destinations return 422 `storage_location_invalid`.

A live move holds new requests, drains existing HTTP requests, streams, asynchronous service work and file cleanup, then closes SQLite. Services retain import/export sessions and confirmation receipts while a stable database facade and managed-directory getters switch to the reopened connection and current paths. The move copies the latest data and backup contents into private staging directories beside their destinations, hashes names/file bytes/empty directories and checks the copied SQLite database. Symbolic links and special files inside a moved directory are rejected. Verified copies are published, the original directories are retained under private names, and settings switch atomically to the new locations. Only then are previous copies removed. A persisted relocation journal also recovers interrupted publication/activation at startup; a failed move restores original locations, reopens SQLite and reports failure in Settings. Waiting requests then resume. If storage cannot safely reopen, the server rejects further requests with 503 instead of opening an empty database. Incomplete deletion is retried on a later start while the new locations stay active. The copy needs additional disk space until the switch completes. The application never overwrites an unrelated destination directory.

A lifetime SQLite lock in `config/.runtime-lock.sqlite` prevents a second backend or manual database migration from opening the same application root during relocation or normal use. The OS releases the lock after process exit; the lock file remains in place and is runtime state, not backup content. Settings and logs remain at the fixed application root. Repository runs continue using its `temp/`; desktop temporary-path selection belongs to Electron integration.

Directly editing `storage.dataDirectory` or `storage.backupsDirectory` selects a location at startup without moving files; use the interface for a checked relocation of an existing installation. Do not edit the internal relocation journal manually.

## Application backups

`POST /backups` saves a verified manual ZIP backup of SQLite and active managed attachments in the configured backup directory, and temporarily queues other requests for consistency. `GET /backups` lists saved archives with available metadata; `GET /backups/{filename}/download` streams a repeatable download. Existing backups and application data are preserved on failure. See the [backup format and lifecycle](docs/application-backup.md) for validation, disk-space requirements and API behavior.

## Persistent preferences

`GET /application-settings` reads effective preferences from `config/settings.json`: language (`system`, `de`, `en`), theme (`system`, `light`, `dark`), accent (`teal`, `blue`, `purple`, `orange`), and attachmentWarnings (`show`, `hide`). A version-1 placeholder remains valid and reads as system language/theme, teal accent and shown file warnings. `PATCH` takes `expected_revision` and a nonempty partial `preferences` object. Writes validate strictly, serialize per configured path within the backend process, sync a private sibling temporary file and rename it over the original; failed/stale writes preserve existing settings. Stale/exhausted revisions return 409 `application_settings_conflict`. Unknown versions, invalid JSON/schema, nonregular files and files over 64 KiB return 503 `application_settings_unavailable` and prevent server startup instead of resetting preferences. No request accepts a settings filesystem path.

The frontend gates its editable UI until settings and inventory views are loaded. Initialization is retryable and uses the persisted backend values.

Inventory views live in SQLite `inventory_views`, keyed by inventory ID with their own revision. `GET /inventory-view-preferences` lists stored views for active inventories; `GET /inventories/{inventory_id}/view-preferences` returns that inventory's complete view (revision 0/defaults if not saved). `PUT` takes `expected_revision` and a complete version-1 `preferences` document; stale writes return 409 `inventory_view_conflict`. Sort/visibility references and manual widths are normalized against active fields, retaining at least one visible field. Manual width bases remain 48–32,768 pixels; a missing `columnWidths` key is the only Auto state, and visual surplus is never stored. Wrapping and attachment previews belong to the same document. Search and filters remain transient.

Presentation writes never advance inventory configuration or item revisions and remain outside inventory archive exchange. Inventory deletion clears its view in the same transaction, with rollback on cascade failure. A complete future application backup will include the view table and application settings file. These preference endpoints use `Cache-Control: no-store`. The frontend keeps an optimistic runtime cache, serializes writes per preference resource with acknowledged revisions, and displays failures until explicit retry or reload. Conflicts never trigger automatic revision guessing or overwriting; explicit reload discards failed local choices. Focus and same-origin BroadcastChannel invalidations refresh idle clients. Delayed refreshes cannot overwrite newer local edits. Pending unsaved preferences activate the browser unload guard; system language follows the client locale.

## Migrations and checks

Drizzle migrations run before the server starts. To generate or apply them manually:

```bash
npm run db:generate -- --dialect sqlite --schema ./src/db/schema.ts --out ./drizzle --name=describe_change
npm run db:migrate
```

Review generated SQL before applying it. Keep `drizzle/` alongside `dist/` when
moving the compiled backend. The explicit relative paths avoid the generator's
absolute snapshot-path handling issue.

Run `npm run check` from the repository root for all quality checks. Backend tests
use `node:test` with synthetic data; HTTP tests require local socket communication.

## API behavior

Item PATCH replaces all editable values while preserving automatic IDs, which must
not be submitted. Omitted values and deleted items retain tombstones with cleared
content. Invalid values return structured 422 errors without partial changes.

`PATCH /inventories/{inventory_id}/items` saves multiple existing items atomically. Send `expected_configuration_revision` and a non-empty `items` array of `{ item_id, expected_revision, values }` replacements, with explicit values and unique item IDs. Any failed row rolls back the entire batch; row-specific domain errors include `detail.item_id`. Saved items are returned in request order with new revisions. Automatic IDs and the configuration revision remain unchanged.

### Revision checks

Items expose `revision`. Item PATCH and DELETE require `expected_revision` in the
JSON body, matching the version being edited or confirmed for deletion. Successful
writes advance the revision; stale requests return 409 `inventory_item_conflict`
without changing data. Field deletion and ID backfills also advance affected item
revisions. Missing or deleted items return 404; invalid revisions return 422.

Inventories expose `configuration_revision`. Load the editor through
`GET /inventories/{inventory_id}/configuration` to read metadata, fields, options,
and revision from one consistent snapshot. Configuration PATCH requires that
revision as `expected_revision`; a stale draft returns 409
`inventory_configuration_conflict` without applying any operations.

Every accepted configuration save advances the revision, including no-op saves.
Metadata, field, option, and group membership changes also advance it, including
writes through individual endpoints. Item value changes and automatic ID counter
increments do not. Use the returned revision rather than assuming an increment of
exactly one. Failed transactions consume no revision.

The frontend keeps conflicting editor drafts until an explicit discard-and-reload.
It does not automatically retry stale writes. Checkbox conflicts offer a list
reload; item deletion conflicts require loading the current item and confirming again.

### Field configuration

Supported field types are `text`, `number`, `boolean`, `checkbox`, `date`, `time`,
`datetime`, `duration`, `select`, `multiselect`, `url`, `attachment`, and `id`.

`is_required` defaults to `false`; `is_sortable` defaults to `true`. Required values
are checked on item creation and replacement, leaving old items unchanged until
edited. Boolean `false` and numeric zero are valid values.

- Text limits are fixed at creation: 1–1,000 characters, default 255.
- Selection options belong to their field; new selection fields require unique initial options.
- Durations use non-negative safe integer seconds.
- URLs contain an HTTP(S) `url` and optional `label`.
- Checkboxes store booleans and use full item replacement when toggled in the table.
- Automatic IDs count from 1 per field and inventory, backfill existing items, and
  remain unchanged during edits. Failed saves consume no number. Deleted numbers
  are reused only with `reuse_deleted_ids`, which selects the smallest free number.

### Atomic inventory editor

`PATCH /inventories/{inventory_id}/configuration` saves optional inventory metadata
and field/option operations in one transaction. Failures roll back the entire
draft, including ID backfills. Field types and text limits remain immutable;
group membership is unchanged. The response includes the inventory and active fields.

Optional `field_order` references every final field exactly once: saved fields use
`field_id`, new fields use their create operation's `client_id`. Do not combine it
with individual position updates. Omitting it preserves append behavior.

Deleting a field clears its stored values and selection options for every field
type. Deleting an option alone preserves existing item references to that option;
future item saves must use valid active options. Deleting an inventory clears its
fields, options, items, and values in the same transaction. Identifiers,
relationships, and existing deletion timestamps are retained as tombstones.
Unrelated inventories and groups are unaffected.

See `/docs` or `/openapi.json` for request schemas and validation details.

### Inventory templates

`/inventory-templates` supports listing and creation; `/{template_id}` supports reading, PATCH, and DELETE. Create a template with `name`, optional `description`, and either an ordered `fields` array or `source_inventory_id` plus `expected_configuration_revision`. Templates contain structure and selection options only, without items, source IDs, counters, memberships, or table preferences. PATCH and DELETE require `expected_revision`; conflicts return 409 `inventory_template_conflict`. PATCH replaces supplied properties, including the complete field array when present. Deletion clears blueprint content and retains a tombstone.

`POST /inventory-templates/{template_id}/inventories` takes `expected_revision` and new inventory metadata (`name`, optional `description` and `group_id`). It atomically creates an independent empty inventory with new field/option IDs and automatic numbering starting at 1 for the first item, returning its configuration. Source, template, and generated inventories remain independent; later changes or deletions do not propagate. Template descriptions are not inherited by generated inventories. Optional `field_indexes` selects zero-based field positions from that template revision; omission includes all fields, and `[]` includes none. Selected fields retain template order. Invalid or repeated positions return 422 without creating records. Ordered snapshots preserve existing selection configurations, including empty option lists; any validation or storage failure leaves existing data unchanged.

### Inventory groups

Inventory groups have one level. `/inventory-groups` supports listing and creation;
`/inventory-groups/{group_id}` supports renaming with PATCH and deletion with DELETE.
Inventory responses include a nullable `group_id`. Send `group_id` when creating or
updating an inventory to assign it to an active group, or send `null` to remove its
membership. Omitting the property in PATCH preserves the existing assignment.

Deleting a group clears its name and records a deletion tombstone. All inventory
memberships are removed in the same transaction, preserving the inventories,
fields, and items. The group migration also supports existing databases, leaving
their inventories initially ungrouped.

### Inventory archive exports

`POST /inventories/{inventory_id}/exports` prepares a complete ZIP containing a versioned `inventory.json` and referenced managed originals in `attachments/`. Its response contains an opaque `id`, safe `filename`, compressed `byte_size` and `expires_at`. `GET /inventories/{inventory_id}/exports/{export_id}/download` consumes it once as a native ZIP download; `DELETE /inventories/{inventory_id}/exports/{export_id}` cancels it. Prepared exports expire after 15 minutes. HEAD on the download endpoint returns 405 without consuming the token. Deleted source inventories are not downloadable. The sidebar inventory context menu offers export; the import icon beside New inventory opens preview and confirmation.

Exports preserve typed saved values, field/option order, automatic numbers/high-water marks and referenced file bytes, with fresh archive-local references rather than source database identities. Original files stream into a private temporary ZIP and must match their stored size and SHA-256. Changes during preparation return 409 `inventory_export_conflict`; inconsistent saved data or failed checksums return 422 `inventory_export_unavailable`. Preparation supports disconnect cancellation; success, failure, download, cancellation and expiry clean temporary files. Startup/periodic/shutdown maintenance sweeps crash leftovers older than 24 hours while protecting active exports. Scratch data lives under `<storage root>/temp/` and does not belong in backups. Export never modifies inventory/item revisions or original files and imposes no attachment-size cap. The streaming ZIP dependency is yazl (including its transitive license notices); ZIP64 is used when required. See the [version-1 archive specification](docs/inventory-archive.md) for saved-state compatibility, references and lifecycle details.

### Inventory archive imports

`POST /inventory-imports` accepts a streamed `application/zip` or `application/octet-stream` body and returns a validated preview with an opaque `id`, inventory name/description, field/item/attachment counts, total uncompressed `attachment_bytes`, `status` and `expires_at`. It creates no inventory or attachment records. `GET /inventory-imports/{import_id}` reads the preview/status; `DELETE` cancels it. `POST /inventory-imports/{import_id}/confirm` accepts a JSON object with optional `name`, `description` and local `group_id` overrides and returns the new inventory. Omitted metadata keeps the archived value. Identical concurrent/repeated confirmations return the same inventory, while changed confirmation parameters return 409 `inventory_import_conflict`. In-progress publication cannot be canceled; clients can recover its result through the same token after a lost response.

The yauzl runtime validates ZIP/ZIP64 Store and Deflate archives sequentially without extracting user paths. Duplicate, unsafe, unexpected, symlink, encrypted or unsupported entries are rejected. Actual uncompressed sizes, CRCs, SHA-256, typed values and ownership references must match the manifest. Unknown format versions return 422 `unsupported_inventory_archive_version`; other invalid archives return 422 `invalid_inventory_archive`. Metadata processing bounds are 64 MiB for `inventory.json` and 524,290 archive entries; export applies matching bounds. These are metadata safeguards, not attachment/ZIP byte-size limits. File bodies remain uncapped and streamed to disk. Include yauzl and its runtime dependency pend in the later third-party notice audit.

Import previews expire after 30 minutes; success receipts last another 30 minutes. Tokens live in memory and become invalid after a backend restart. Validated originals are rechecked while being copied to fresh managed UUID files, then all inventory/field/option/item/value/file metadata is published in one SQLite transaction. Database failure rolls back every row, and failed preparation removes new file copies; failed physical unlinks are retried by reconciliation. Publication preserves visible automatic numbers/high-water marks, item order, historical missing required values and unavailable selection references while creating fresh technical identities. Destination inventories are always independent; existing inventories are never replaced. Cancel, expiry and completed publication clear staging files, and startup/periodic/shutdown maintenance handles orphan workspaces. See the [archive specification](docs/inventory-archive.md) for the full format and lifecycle.

### Managed attachments

An `attachment` field holds an ordered, non-empty array of unique file IDs. Upload a managed copy with `POST /inventories/{inventory_id}/fields/{field_id}/attachments`, a binary `application/octet-stream` body, required URI-encoded UTF-8 `X-File-Name`, and optional `X-File-Type`. Original filenames are display metadata, never filesystem paths. Uploads stream into private opaque files under the configured attachments directory; the application imposes no per-file size limit. A completed upload returns metadata and an unclaimed ID without changing item or configuration revisions. Save that ID in the cell through ordinary item creation/replacement or atomic batch replacement; claims and removals commit in that same transaction. A file cannot be shared across fields, inventories, or items. Omitting an optional attachment field removes its saved files; an empty array is invalid. Item responses include an optional `attachments` metadata list when files are present.

`GET /inventories/{inventory_id}/fields/{field_id}/attachments/{attachment_id}` reads metadata; append `/download` to retrieve bytes. Downloads always use `Content-Disposition: attachment`, the original filename, `application/octet-stream`, `nosniff`, and `no-store`, including images. Opening a system application is deferred until a feature release after the initial release. `DELETE` on the metadata endpoint discards only unclaimed stages; canceling a saved file returns 409 `attachment_already_attached`, so a failed or lost save response cannot accidentally delete a committed file. Permanent removal uses revision-checked item editing instead.

`GET /inventories/{inventory_id}/fields/{field_id}/attachments/{attachment_id}/preview` validates PNG, JPEG, GIF, or WebP file signatures and uses sharp to produce a static, metadata-free WebP fitted inside 320 × 240 pixels without enlargement. Derivatives are generated on demand, served with `nosniff` and `no-store`, and never saved. Native decoding runs serially with a 100-million-source-pixel bound and a five-second processing timeout; these affect previews only, not file copying. Unsupported, corrupt, or impractical images return 415 `attachment_preview_unavailable`, leaving originals downloadable. Other formats, including SVG and PDF, are not embedded. The native sharp/libvips runtime must be included in desktop packaging and the third-party license audit.

SQLite transactions clear metadata and retain deletion identities before files are physically removed. Successful mutation responses schedule file cleanup; startup, one-minute maintenance, and shutdown also reconcile storage. Failed unlinks keep a retryable purge marker. Abandoned unclaimed stages expire after 24 hours; old interrupted/unreferenced opaque files are swept after the same grace period, while active uploads and unrelated filenames are preserved. Item, field, and inventory deletion clear dependent file metadata in their existing transactions, so failed saves/cascades never delete still-referenced bytes. Filesystem and database commits are separate: physical removal is eventual and retried, and expired drafts must upload their files again. Backups must eventually include both SQLite and managed files.
