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

| Variable              | Default                                   |
| --------------------- | ----------------------------------------- |
| `INVENTORY_DATA_DIR`  | Repository-relative `InventoryData/node/` |
| `INVENTORY_DB_PATH`   | `<data directory>/inventory.db`           |
| `INVENTORY_HOST`      | `127.0.0.1`                               |
| `INVENTORY_PORT`      | `8000`                                    |
| `INVENTORY_LOG_LEVEL` | `INFO`                                    |

Storage overrides must be absolute paths; `~/` is supported. Logs and the prepared
attachment directory are stored under the data directory.

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

### Field configuration

Supported field types are `text`, `number`, `boolean`, `checkbox`, `date`, `time`,
`datetime`, `duration`, `select`, `multiselect`, `url`, and `id`.

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

Field and option deletion retain existing item values, except deleting an ID field
clears its number assignments. Deletion tombstones are preserved.

See `/docs` or `/openapi.json` for request schemas and validation details.

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
