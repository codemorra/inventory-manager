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
npm run db:generate -- --name=describe_change
npm run db:migrate
```

Review generated SQL before applying it. Keep `drizzle/` alongside `dist/` when
moving the compiled backend.

Run `npm run check` from the repository root for all quality checks. Backend tests
use `node:test` with synthetic data; HTTP tests require local socket communication.

## API behavior

Item PATCH replaces all active values. Deletions preserve tombstones for future
synchronization. Invalid item values return structured 422 errors.

The inventory editor saves through `PATCH /inventories/{inventory_id}/configuration`.
The request contains optional `inventory` metadata and `fields` and `options` arrays
of create, update, or delete operations. New field definitions include their initial
options. Omitted operation arrays leave existing records unchanged; this endpoint
does not replace the entire field list. The response contains the saved inventory
and its active fields with options.

All editor operations run in one database transaction. Invalid data, unrelated or
deleted identifiers, and persistence errors roll back the entire save. Existing
field and option IDs are preserved, field types and text limits remain immutable,
and inventory group membership is unchanged. Field and option deletions retain
their tombstones and existing item values. Individual configuration endpoints
remain available; item PATCH continues to replace all active values.

Inventory groups have one level. `/inventory-groups` supports listing and creation;
`/inventory-groups/{group_id}` supports renaming with PATCH and deletion with DELETE.
Inventory responses include a nullable `group_id`. Send `group_id` when creating or
updating an inventory to assign it to an active group, or send `null` to remove its
membership. Omitting the property in PATCH preserves the existing assignment.

Deleting a group clears its name and records a deletion tombstone. All inventory
memberships are removed in the same transaction, preserving the inventories,
fields, and items. The group migration also supports existing databases, leaving
their inventories initially ungrouped.
