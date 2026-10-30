# Backend API

This reference describes behavior beyond the request schemas in `/docs`, `/redoc` and `/openapi.json`. Routes below omit the `/api` prefix; combined browser and desktop runtimes use that prefix.

## Items and configuration

Item PATCH replaces all editable values while preserving automatic IDs, which must not be submitted. Omitted values and deleted items retain tombstones with cleared content. Invalid values return structured 422 errors without partial changes.

`PATCH /inventories/{inventory_id}/items` saves multiple existing items atomically. Send `expected_configuration_revision` and a non-empty `items` array of `{ item_id, expected_revision, values }` replacements, with explicit values and unique item IDs. Any failed row rolls back the entire batch; row-specific domain errors include `detail.item_id`. Saved items are returned in request order with new revisions. Automatic IDs and the configuration revision remain unchanged.

### Revision checks

Items expose `revision`. Item PATCH and DELETE require `expected_revision` in the JSON body, matching the version being edited or confirmed for deletion. Successful writes advance the revision; stale requests return 409 `inventory_item_conflict` without changing data. Field deletion and ID backfills also advance affected item revisions. Missing or deleted items return 404; invalid revisions return 422.

Inventories expose `configuration_revision`. Load the editor through `GET /inventories/{inventory_id}/configuration` to read metadata, fields, options, and revision from one consistent snapshot. Configuration PATCH requires that revision as `expected_revision`; a stale draft returns 409 `inventory_configuration_conflict` without applying any operations.

Every accepted configuration save advances the revision, including no-op saves. Metadata, field, option, and group membership changes also advance it, including writes through individual endpoints. Item value changes and automatic ID counter increments do not. Use the returned revision rather than assuming an increment of exactly one. Failed transactions consume no revision.

The frontend keeps conflicting editor drafts until an explicit discard-and-reload. It does not automatically retry stale writes. Checkbox conflicts offer a list reload; item deletion conflicts require loading the current item and confirming again.

### Field configuration

Supported field types are `text`, `number`, `boolean`, `checkbox`, `date`, `time`, `datetime`, `duration`, `select`, `multiselect`, `url`, `attachment`, and `id`.

`is_required` defaults to `false`; `is_sortable` defaults to `true`. Required values are checked on item creation and replacement, leaving old items unchanged until edited. Boolean `false` and numeric zero are valid values.

- Text limits are fixed at creation: 1–1,000 characters, default 255.
- Selection options belong to their field; new selection fields require unique initial options.
- Durations use non-negative safe integer seconds.
- URLs contain an HTTP(S) `url` and optional `label`.
- Checkboxes store booleans and use full item replacement when toggled in the table.
- Automatic IDs count from 1 per field and inventory, backfill existing items, and remain unchanged during edits. Failed saves consume no number. Deleted numbers are reused only with `reuse_deleted_ids`, which selects the smallest free number.

### Atomic inventory editor

`PATCH /inventories/{inventory_id}/configuration` saves optional inventory metadata and field/option operations in one transaction. Failures roll back the entire draft, including ID backfills. Field types and text limits remain immutable; group membership is unchanged. The response includes the inventory and active fields.

Optional `field_order` references every final field exactly once: saved fields use `field_id`, new fields use their create operation's `client_id`. Do not combine it with individual position updates. Omitting it preserves append behavior.

Deleting a field clears its stored values and selection options for every field type. Deleting an option alone preserves existing item references to that option; future item saves must use valid active options. Deleting an inventory clears its fields, options, items, and values in the same transaction. Identifiers, relationships, and existing deletion timestamps are retained as tombstones. Unrelated inventories and groups are unaffected.

### Inventory templates

`/inventory-templates` supports listing and creation; `/{template_id}` supports reading, PATCH, and DELETE. Create a template with `name`, optional `description`, and either an ordered `fields` array or `source_inventory_id` plus `expected_configuration_revision`. Templates contain structure and selection options only, without items, source IDs, counters, memberships, or table preferences. PATCH and DELETE require `expected_revision`; conflicts return 409 `inventory_template_conflict`. PATCH replaces supplied properties, including the complete field array when present. Deletion clears blueprint content and retains a tombstone.

`POST /inventory-templates/{template_id}/inventories` takes `expected_revision` and new inventory metadata (`name`, optional `description` and `group_id`). It atomically creates an independent empty inventory with new field/option IDs and automatic numbering starting at 1 for the first item, returning its configuration. Source, template, and generated inventories remain independent; later changes or deletions do not propagate. Template descriptions are not inherited by generated inventories. Optional `field_indexes` selects zero-based field positions from that template revision; omission includes all fields, and `[]` includes none. Selected fields retain template order. Invalid or repeated positions return 422 without creating records. Ordered snapshots preserve existing selection configurations, including empty option lists; any validation or storage failure leaves existing data unchanged.

### Inventory groups

Inventory groups have one level. `/inventory-groups` supports listing and creation; `/inventory-groups/{group_id}` supports renaming with PATCH and deletion with DELETE. Inventory responses include a nullable `group_id`. Send `group_id` when creating or updating an inventory to assign it to an active group, or send `null` to remove its membership. Omitting the property in PATCH preserves the existing assignment.

Deleting a group clears its name and records a deletion tombstone. All inventory memberships are removed in the same transaction, preserving the inventories, fields, and items.

## Persistent preferences

`GET /application-settings` reads effective preferences from `config/settings.json`: language (`system`, `de`, `en`), theme (`system`, `light`, `dark`), accent (`brand`, `cyan`, `blue`, `purple`, `orange`, `slate`), and attachmentWarnings (`show`, `hide`). Missing preferences default to system language/theme, brand accent and shown file warnings. `PATCH` takes `expected_revision` and a nonempty partial `preferences` object. Writes validate strictly, serialize per configured path within the backend process, sync a private sibling temporary file and rename it over the original; failed/stale writes preserve existing settings. Stale/exhausted revisions return 409 `application_settings_conflict`. Unknown versions, invalid JSON/schema, nonregular files and files over 64 KiB return 503 `application_settings_unavailable` and prevent server startup instead of resetting preferences. No request accepts a settings filesystem path.

Inventory views live in SQLite `inventory_views`, keyed by inventory ID with their own revision. `GET /inventory-view-preferences` lists stored views for active inventories; `GET /inventories/{inventory_id}/view-preferences` returns that inventory's complete view (revision 0/defaults if not saved). `PUT` takes `expected_revision` and a complete version-1 `preferences` document; stale writes return 409 `inventory_view_conflict`. Sort/visibility references and manual widths are normalized against active fields, retaining at least one visible field. Manual width bases remain 48–32,768 pixels; a missing `columnWidths` key is the only Auto state, and visual surplus is never stored. Wrapping and attachment previews belong to the same document. Search and filters remain transient.

Presentation writes never advance inventory configuration or item revisions and remain outside inventory archive exchange. Inventory deletion clears its view in the same transaction, with rollback on cascade failure. Data backups include the view table; file-backed application settings are separate. These preference endpoints use `Cache-Control: no-store`. The frontend keeps an optimistic runtime cache, serializes writes per preference resource with acknowledged revisions, and displays failures until explicit retry or reload. Conflicts never trigger automatic revision guessing or overwriting; explicit reload discards failed local choices. Focus and same-origin BroadcastChannel invalidations refresh idle clients. Delayed refreshes cannot overwrite newer local edits. Pending unsaved preferences activate the browser unload guard; system language follows the client locale.

## Manual update checks

`GET /application-update` performs an on-demand unauthenticated GitHub check for the fixed public repository `codemorra/inventory-manager`. It has no request body or configurable repository URL and returns `Cache-Control: no-store`. All completed checks return HTTP 200 with `current_version` and `status`: `available`, `current`, `no_release`, `failed` or `rate_limited`. `available` and `current` also include `latest_version` and a project-owned `release_url`. `current` means that the published version is not newer, including when the local version is ahead.

The checker uses `/repos/codemorra/inventory-manager/releases/latest`, validates a regular published release and accepts only `vX.Y.Z` tags. Installed versions must be `X.Y.Z`. Each numeric component is compared without integer precision loss; for example, `1.10.0` is newer than `1.9.0`. Unsupported tags or malformed responses yield `failed`. A 404 is reported as `no_release` only if a second request confirms that the public repository is available; otherwise it is a failure.

The complete GitHub operation, including response-body reads and the optional repository check, has a seven-second deadline. Concurrent checks share an in-flight operation. GitHub rate-limit deadlines are respected in memory; responses without a deadline use a one-minute pause. Requests use outbound HTTPS with the application name/version in User-Agent, without application data or a GitHub token. Checks are manual, with no automatic installation, retries, persisted results or settings/data revision changes.

## Managed attachments

An `attachment` field holds an ordered, non-empty array of unique file IDs. Upload a managed copy with `POST /inventories/{inventory_id}/fields/{field_id}/attachments`, a binary `application/octet-stream` body, required URI-encoded UTF-8 `X-File-Name`, and optional `X-File-Type`. Original filenames are display metadata, never filesystem paths. Uploads stream into private opaque files under the configured attachments directory; the application imposes no per-file size limit. A completed upload returns metadata and an unclaimed ID without changing item or configuration revisions. Save that ID in the cell through ordinary item creation/replacement or atomic batch replacement; claims and removals commit in that same transaction. A file cannot be shared across fields, inventories, or items. Omitting an optional attachment field removes its saved files; an empty array is invalid. Item responses include an optional `attachments` metadata list when files are present.

`GET /inventories/{inventory_id}/fields/{field_id}/attachments/{attachment_id}` reads metadata; append `/download` to retrieve bytes. Downloads always use `Content-Disposition: attachment`, the original filename, `application/octet-stream`, `nosniff`, and `no-store`, including images. `DELETE` on the metadata endpoint discards only unclaimed stages; canceling a saved file returns 409 `attachment_already_attached`, so a failed or lost save response cannot accidentally delete a committed file. Permanent removal uses revision-checked item editing instead.

`GET /inventories/{inventory_id}/fields/{field_id}/attachments/{attachment_id}/preview` validates PNG, JPEG, GIF, or WebP file signatures and uses sharp to produce a static, metadata-free WebP fitted inside 320 × 240 pixels without enlargement. Derivatives are generated on demand, served with `nosniff` and `no-store`, and never saved. Native decoding runs serially with a 100-million-source-pixel bound and a five-second processing timeout; these affect previews only, not file copying. Unsupported, corrupt, or impractical images return 415 `attachment_preview_unavailable`, leaving originals downloadable. Other formats, including SVG and PDF, are not embedded. Desktop builds include the native sharp/libvips runtime.

SQLite transactions clear metadata and retain deletion identities before files are physically removed. Successful mutation responses schedule file cleanup; startup, one-minute maintenance, and shutdown also reconcile storage. Failed unlinks keep a retryable purge marker. Abandoned unclaimed stages expire after 24 hours; old interrupted/unreferenced opaque files are swept after the same grace period, while active uploads and unrelated filenames are preserved. Item, field, and inventory deletion clear dependent file metadata in their existing transactions, so failed saves/cascades never delete still-referenced bytes. Filesystem and database commits are separate: physical removal is eventual and retried, and expired drafts must upload their files again. Data backups include both SQLite and managed files.

## Archive exchange and backups

See [inventory archives](inventory-archive.md) for single-inventory import/export and [application backups](application-backup.md) for full data backups, restoration and automatic scheduling. Storage relocation is described in [storage configuration](storage.md#storage-api-and-recovery).
