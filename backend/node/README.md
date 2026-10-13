# Express backend migration — step 1

This directory contains the Node backend foundation. FastAPI remains the reference
and the application backend until the configuration and item APIs have been migrated.
Only `/health` is available here so far.

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
Foreign keys use `NO ACTION`; soft deletion belongs to the later services.

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
owns initialization and shutdown. Services and repositories will be added in steps
2–3 without Express types in domain code. Once parity is verified, the contents of
`backend/node/` will move directly into `backend/`; `drizzle/` remains the migration
directory. The Python `app/` stays in place until the migration is complete.

The HTTP layer retains the two Vite CORS origins and disables credentials. JSON
bodies have an explicit 1 MiB limit (413 for excess); malformed JSON returns 422.
Unexpected errors are logged and return a generic JSON 500 without stack traces.

Root quality scripts and Electron packaging remain for the later migration steps.
