# Express backend migration — step 3

This directory contains the Node backend foundation, inventory configuration APIs,
and item APIs. FastAPI remains the reference and the frontend's backend until the
final integration validation and replacement in step 4.

Available: `/health`, inventory CRUD, field CRUD, option listing/create/rename/delete,
and item CRUD under `/inventories/:inventory_id/items`.

## Development and checks

Node.js 24 or later is required. Install dependencies and work from this directory:

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```

Use `npm start` to run the compiled backend after building. The default address is
`http://127.0.0.1:8000`; stop FastAPI first or choose a different Node port.

Tests use Node's built-in `node:test` runner with `node:assert/strict`; `tsx` loads
the TypeScript test files. They use synthetic data in temporary directories. API tests require local socket
communication; a sandbox that blocks it must run these checks outside that restriction.

## Configuration

| Variable              | Default                                                    |
| --------------------- | ---------------------------------------------------------- |
| `INVENTORY_DATA_DIR`  | Repository-relative `InventoryData/node/` during migration |
| `INVENTORY_DB_PATH`   | `<data directory>/inventory.db`                            |
| `INVENTORY_HOST`      | `127.0.0.1`                                                |
| `INVENTORY_PORT`      | `8000`                                                     |
| `INVENTORY_LOG_LEVEL` | `INFO`                                                     |

Storage overrides must be absolute paths; `~/` is expanded. The database factory
also accepts an explicit absolute path, independently of the process working directory.
For example:

```bash
INVENTORY_DATA_DIR=/tmp/inventory-node-dev INVENTORY_PORT=8001 npm run dev
```

Startup preserves the attachment-directory preparation at `<data directory>/attachments`.
Logs go to `<data directory>/logs/inventory-manager.log`, rotating at 1,000,000 bytes
with five backups. Shutdown flushes the log and closes HTTP and SQLite resources.

The Node baseline uses a fresh database. No Python database or Alembic history is
imported, inspected, or converted. The separate development default avoids opening
the existing Python development database. Point storage overrides at a fresh location.

## Schema and migrations

`src/db/schema.ts` defines the five domain tables and the approved lookup indexes.
IDs are UUID strings, lifecycle timestamps are UTC ISO strings, and dynamic values
are JSON in a text column. UUID/timestamp defaults run in Drizzle, not as SQL defaults.
Foreign keys use `NO ACTION`. Inventory, field, and option deletion uses tombstones:
the name is cleared and `deleted_at` is set; deleting an inventory also clears its
description. Child records and stored option IDs are preserved. Active resources
are accessed through active parents.

The regular Drizzle migrator applies `drizzle/0000_initial_schema.sql` before the
server listens. Its migration journal makes repeated startups preserve data and
skip applied migrations. A migration failure aborts startup and closes the database.

```bash
npm run db:generate -- --name=describe_schema_change
npm run db:migrate
```

Review generated SQL before applying it. Both the migration CLI and server use the
same path configuration. The `drizzle/` directory stays next to `dist/` and must accompany
the compiled backend when it is moved or packaged.

`createApp()` has no filesystem, database, or listener side effects. `startServer()`
owns initialization and shutdown. The `inventories/`, `fields/`, `options/`, and `items/`
feature folders each contain validation, a service, and a repository. Routes and
frontend DTO mapping stay under `routes/`; domain code has no Express types or HTTP
status codes. Validation is invoked by the services, including direct calls.
Field lists load their options together, and creating a field with its initial
options is transactional. Once parity is verified, the contents of
`backend/node/` will move directly into `backend/`; `drizzle/` remains the migration
directory. The Python `app/` stays in place until the migration is complete.

Configuration APIs retain the existing frontend's paths, snake-case response fields,
201/200/204 statuses, and structured 404/422 domain errors. Input validation returns
422 with a `detail` issue list (`type`, `loc`, `msg`); framework-specific messages
and issue types reflect Zod instead of reproducing all Pydantic internals. Unknown
input properties are ignored. No-op patches preserve timestamps.

Initial selection options must have distinct names after trimming and full Unicode
case folding, with a maximum of 100 initial options. Later additions and renames
allow duplicate names and do not impose that initial count limit. The last option
may be deleted. Positions use the active record count without renumbering, and
lists retain the existing name/position ordering. Field type and text length cannot
be changed by PATCH. Shared name validation counts Unicode code points before
trimming; the case-folding data matches the Python reference's Unicode 16.0 rules.

## Items and dynamic values

Item create and PATCH accept `{ values: [{ field_id, value }] }`. Omitted `values`
default to an empty set; fields are not required, but an explicit `value: null` is
invalid. PATCH replaces the entire active value set, preserving old rows as cleared
tombstones and creating new IDs for replacement values. The item's own `updated_at`
does not change when only its values change. Item deletion tombstones the item and
all active values without touching earlier tombstones.

Validation runs in the service using the active field definitions and options of
the parent inventory. Duplicate, unknown, foreign, and deleted field IDs are invalid.
Text preserves whitespace and counts Unicode code points. Numbers must be finite,
booleans must be booleans, and duration is a nonnegative integer value without a
new unit interpretation. Select values are active option IDs; multiselect is a
nonempty array of active IDs, preserving order and duplicates. Existing values
referencing deleted fields or options remain readable but cannot be resubmitted.

Date, time, and datetime values retain their original strings, including supported
basic/extended formats, ISO week dates, fractional seconds, offsets, local datetimes,
and midnight represented by `24:00`. Invalid value types return the structured 422
`invalid_inventory_item_value` error. The known FastAPI behavior for malformed
temporal strings is deliberately preserved as a generic plain-text 500; correcting
that behavior is a separate change.

JavaScript does not retain the distinction between JSON numeric tokens `1` and
`1.0`; duration validation therefore checks their integer value. Non-finite numbers
are rejected before persistence so direct service callers cannot accidentally
store JSON null in place of a number. JavaScript's normal number precision applies.

Create, replacement, and deletion run in transactions; failures leave the item and
its value history unchanged. Lists retain newest-first item ordering and load
values together instead of issuing a query per item. Mutation inputs have no added
count limit; value insertion uses bounded batches within the same transaction to
respect SQLite's parameter limit.

The HTTP layer retains the two Vite CORS origins and disables credentials. JSON
bodies have an explicit 1 MiB limit (413 for excess); malformed JSON returns 422.
Unexpected errors are logged and return a generic JSON 500 without stack traces.

Root quality scripts and Electron packaging remain for the later migration steps.
