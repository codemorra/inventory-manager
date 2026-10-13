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
synchronization. Malformed date/time value strings currently return 500; other
invalid values return structured 422 errors.
