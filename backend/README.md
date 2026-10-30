# Inventory Manager backend

The Express/TypeScript backend stores data in SQLite through Drizzle and manages attachments, archive exchange and backups. It requires Node.js 24 or later.

## Run locally

From `backend/`:

```bash
npm ci
npm run dev
```

`better-sqlite3` is a native dependency; its installation script must run. Compiling it from source requires C/C++ build tools and Node headers.

For the compiled backend:

```bash
npm run build
npm start
```

The default address is `http://127.0.0.1:8000`. `/health` checks readiness. API documentation is served at `/docs`, `/redoc` and `/openapi.json`. Startup applies database migrations.

Copy `.env.example` to `.env` for local overrides. See [storage and configuration](../docs/storage.md) for environment variables, paths and recovery behavior. Stop the backend before starting another runtime or a manual migration against the same application root.

## API maintenance

Routes live in `src/routes/`, domain logic in services and repositories, and database definitions in `src/db/`. Keep `src/openapi.json` in sync with route and DTO changes. Its served version is injected from the [application version](../docs/app-versioning.md).

API routes are available under `/api`. Without `INVENTORY_FRONTEND_DIR`, unprefixed development routes are also available. With a built frontend configured, API requests use `/api` to avoid frontend-route collisions; `/health`, `/docs`, `/redoc` and `/openapi.json` stay at the root.

- [API behavior](../docs/backend-api.md): revisions, configuration, templates, preferences, updates and attachments
- [Inventory archives](../docs/inventory-archive.md): ZIP exchange format and import/export lifecycle
- [Application backups](../docs/application-backup.md): validation, restoration and scheduling
- [Storage and recovery](../docs/storage.md#storage-api-and-recovery): relocation and runtime locking

## Migrations

From `backend/`, generate or apply migrations with:

```bash
npm run db:generate -- --dialect sqlite --schema ./src/db/schema.ts --out ./drizzle --name=describe_change
npm run db:migrate
```

Review generated SQL before applying it and preserve migration history. Keep `drizzle/` alongside `dist/` when moving the compiled backend. The explicit relative paths avoid the generator's absolute snapshot-path handling issue.

## Checks

From the repository root, `npm run check` runs all package checks. For backend checks only, run from `backend/`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Tests use `node:test`, Supertest and temporary synthetic data. HTTP tests require local sockets. See the [development guide](../docs/development.md) for the other packages and desktop smoke tests.
