# Inventory archive format

Format version 1 is a ZIP containing one UTF-8 `inventory.json` at the root and zero or more regular file entries named `attachments/<key>`. ZIP64 is used automatically when needed. Attachment bodies are original managed copies, not previews or base64 strings. The backend provides export preparation/download and validated import preview/confirmation; user interface integration follows in the next implementation section.

## Manifest

```json
{
  "format": "inventory-manager",
  "version": 1,
  "inventory": {
    "name": "Cables",
    "description": null
  },
  "fields": [
    {
      "key": "f1",
      "name": "Cable",
      "field_type": "text",
      "max_length": 255,
      "is_required": false,
      "is_sortable": true,
      "reuse_deleted_ids": false,
      "last_assigned_id": 0,
      "options": []
    }
  ],
  "items": [
    {
      "key": "i1",
      "values": [{ "field": "f1", "value": "USB-C cable" }]
    }
  ],
  "attachments": []
}
```

`format` identifies this application format; `version` describes the archive schema independently of the application version. Unknown versions must not be interpreted as version 1. Objects reject unknown properties. Keys contain 1–128 ASCII letters, digits, underscores or hyphens; they are archive-local references, never source database identities or local paths. Field, item and attachment keys are unique in their respective lists; option keys are unique across all fields. Export currently generates `f1`, `i1`, `o1` and `a1` style keys, but consumers must not derive relationships from their spelling.

Array order preserves field order, per-field option order, saved item order and attachment order within a cell. Each item contains at most one value per field. Omitted values represent absent saved values. Names, descriptions, field types/settings and present values follow the application's data rules. Source groups, templates, table preferences, search/filter state, revisions, timestamps, deletion history and unclaimed attachment stages are excluded.

## Typed values and references

| Field type                 | JSON value                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `text`                     | String within the field's character limit.                                         |
| `number`                   | Finite number; zero is valid.                                                      |
| `boolean`, `checkbox`      | Boolean; false is valid.                                                           |
| `date`, `time`, `datetime` | String accepted by the application's temporal validation.                          |
| `duration`                 | Non-negative safe integer seconds.                                                 |
| `url`                      | Object with an HTTP(S) `url` and optional `label`.                                 |
| `select`                   | One option key belonging to this field.                                            |
| `multiselect`              | Non-empty ordered array of option keys belonging to this field.                    |
| `attachment`               | Non-empty ordered array of unique attachment keys belonging to this cell.          |
| `id`                       | Positive safe integer, unique within its field and at most its `last_assigned_id`. |

Each field declares `max_length`, `is_required`, `is_sortable`, `reuse_deleted_ids`, `last_assigned_id` and `options`. Only text fields use `max_length`; other types use null. Only ID fields can enable number reuse or have nonzero `last_assigned_id`. Every saved item has a value for each ID field. ID numbers and high-water marks are transfer data; an importer must allocate fresh technical identities without renumbering visible IDs or accidentally reusing numbers deleted in the source.

Select/multiselect options have `{ "key": "o1", "available": true, "name": "USB" }`. Existing inventories may have empty option lists or repeated names after ordinary editing. A previously deleted option that is still referenced by an item is represented as `{ "key": "o2", "available": false, "name": null }`. Such records are included only when referenced. They preserve the unavailable-reference state without recovering deleted names or offering the option as a new selectable choice.

Existing entries can lack values for fields made required later. Inventory exchange preserves that saved history; later ordinary item saves still enforce required fields. This exception does not permit incorrectly typed present values, unknown references, duplicate value fields or invalid file ownership. Import must use dedicated snapshot validation/materialization rather than replaying ordinary item creation, which assigns automatic IDs and applies new-entry requirements.

## Attachment metadata

```json
{
  "key": "a1",
  "field": "f3",
  "item": "i1",
  "filename": "photo.png",
  "media_type": "image/png",
  "byte_size": 12345,
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

The referenced file entry is exactly `attachments/a1`. `filename` is display metadata and follows managed attachment filename validation; it must not become an extraction path. Duplicate display filenames are allowed because archive keys are distinct. `media_type` is metadata, not permission to execute or embed a file. `byte_size` is a non-negative safe integer, including zero; `sha256` is a lowercase 64-digit hexadecimal checksum of the uncompressed original bytes. Each file belongs to exactly one item/field cell and must be referenced there. Extra, missing or multiply claimed files are invalid. Downloading an original retains its existing download-only behavior.

## Export lifecycle

`POST /inventories/{inventory_id}/exports` builds a complete private archive before returning its opaque ID, safe filename, compressed byte count and expiry time. Managed files are streamed sequentially and their actual bytes checked against saved sizes and checksums. Relevant inventory changes during construction reject the export rather than producing a mixed snapshot. An inventory containing inconsistent saved data or missing/corrupt files cannot be silently exported without that content.

`GET /inventories/{inventory_id}/exports/{export_id}/download` claims that prepared archive for one native download. It serves `application/zip`, attachment disposition, exact content length, `nosniff` and `no-store`. A HEAD probe returns 405 without claiming the archive. `DELETE /inventories/{inventory_id}/exports/{export_id}` cancels it. Tokens are inventory-scoped and expire after 15 minutes; expiry, cancellation and download completion dispose the temporary artifact. A process restart invalidates prepared tokens; interrupted export directories older than 24 hours are reconciled by startup/periodic maintenance. Active artifacts are protected from sweeping. The backend creates scratch data only beneath its explicitly configured managed directory (`.exchange/`). These temporary archives are not part of application backup data.

Export preparation supports cancellation when its HTTP client disconnects. Failures remove partial archives without changing inventory/item revisions, attachment ownership or original bytes. Large managed files and ZIP64 archives do not acquire an application-imposed attachment-size cap; exports require temporary disk space in addition to originals. A completed archive is a saved snapshot, independent of later ordinary edits; deletion of the source inventory prevents claiming its prepared exports.

## Import lifecycle

`POST /inventory-imports` accepts a binary `application/zip` or `application/octet-stream` request. It copies the ZIP to private scratch storage and validates its central directory with lazy, strict filename handling. Only Store and Deflate methods and regular files are accepted. One optional empty `attachments/` directory entry is permitted. Duplicate or unexpected paths, traversal, absolute names, symlinks, encryption and damaged archives are rejected. Entry CRCs and actual decompressed lengths are checked while streaming; attachment lengths and SHA-256 must also match the JSON manifest. UTF-8 decoding is strict, and present values must match their declared types and references. Unknown manifest versions return `unsupported_inventory_archive_version`; other format failures use `invalid_inventory_archive` (both HTTP 422).

A successful response contains `id`, `expires_at`, archived inventory metadata, `field_count`, `item_count`, `attachment_count`, total uncompressed `attachment_bytes` and a `status` of `ready`. No active database records are created. Staged files use generated local names unrelated to entry paths or display filenames. Once verified, the original staged ZIP is deleted; the checked manifest and staged originals are retained for confirmation without re-uploading. `GET /inventory-imports/{import_id}` returns the current summary; status can also be `importing` or `completed`, with `inventory_id` on success. `DELETE` cancels a ready preview or discards a completed receipt without deleting the imported inventory/files. In-progress publication returns 409 when cancellation is attempted.

`POST /inventory-imports/{import_id}/confirm` takes a JSON object, optionally overriding `name`, `description` and `group_id`. Absent name/description keep the archive values; group membership is assigned only from the local request. The importer rechecks staged originals while streaming fresh managed file copies, then atomically publishes the independent inventory and all relationships in SQLite. Database and filesystem commits remain separate: any failed publication rolls back database writes and removes newly copied files; failed unlinks remain eligible for ordinary managed-file reconciliation. A lease protects pending file copies from orphan sweeps before commit. Existing inventories and original source files remain untouched.

Technical IDs, timestamps and revisions are new. Automatic numbers and their high-water marks/reuse settings are preserved rather than assigned through ordinary item creation. The explicit newest-first archive item order is reconstructed using fresh distinct descending creation timestamps, matching ordinary item listing without depending on generated UUID ordering. Unavailable selection references become new cleared deletion placeholders, never active choices or restored names. Missing historical required values remain missing, and subsequent ordinary saves still enforce requirements.

Identical simultaneous confirmations join the same operation; identical later retries return its existing inventory instead of creating another. Different confirmation parameters for a pending or completed session return 409 `inventory_import_conflict`. The successful receipt is recorded before staging cleanup, so a lost HTTP response or failed cleanup cannot duplicate the result. Confirmation continues after a client disconnects; clients can query status or repeat the same confirmation. Deleted successful inventories are not recreated by a retry.

Ready previews expire after 30 minutes; a successful confirmation retains its receipt for another 30 minutes. Active publication is protected from expiry cleanup. After expiry or backend restart the token is unavailable (`inventory_import_not_found`, HTTP 404); a fresh selection is required. Completed staging is removed immediately or retried by maintenance. Interrupted-process workspaces older than 24 hours are swept without touching active previews or imported originals. Application backup must exclude `.exchange/` scratch files.

## Processing bounds

Inventory JSON is bounded to 64 MiB and the archive directory to 524,290 entries. Export enforces the same bounds so it cannot offer an archive its own importer would reject. These constrain metadata processing rather than attachment size; there is no application-imposed per-file or whole-ZIP byte cap. Actual decompressed file data must stay within each manifest-declared length and pass its hash; compressed header claims alone are never trusted. Processing is sequential and original bytes are not buffered in full. Total attachment bytes must fit a safe JSON integer. Storage exhaustion and other filesystem failures leave no partial active inventory and are reported as storage errors.
