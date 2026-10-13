# inventory-manager

> This project is currently under development.

`inventory-manager` is a local application for flexible management of personal inventories.

Users can create inventory lists, define custom fields, and manage items with typed values. Each inventory has its own field configuration, including text limits and options for select and multiselect fields.

The application uses a React/TypeScript frontend, an Express/TypeScript backend, and local SQLite storage through Drizzle. A responsive sidebar provides direct access to inventories, while tables and dialogs support configuration and item management.

## Current features

- Create, view, edit, and delete inventory lists
- Define, rename, and delete configurable fields for inventory lists
- Configure text limits and select or multiselect options per field
- Add, rename, and delete options for existing select and multiselect fields
- Support text, number, boolean, date, time, datetime, duration, select, and multiselect field types
- Create, view, edit, and delete local inventory items with typed field values
- Local SQLite storage with Drizzle database migrations
- Local application logging with size-based rotation
- Responsive interface based on Tailwind CSS
- English and German interface with system-language detection
- System, light, and dark appearance modes with persistent preferences

## Development

Node.js 24 or later and npm are required. Install each package from the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

The packages retain independent lockfiles. `better-sqlite3` is a native dependency;
its installation must complete successfully before running the backend. See
[backend documentation](backend/README.md).

Start the backend and frontend in separate terminals:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

The backend defaults to `http://127.0.0.1:8000`; the Vite frontend usually runs at
`http://localhost:5173`. Verify backend readiness at `/health`. The backend applies
Drizzle migrations before listening, creating an empty database on first startup.

For a compiled backend:

```bash
npm --prefix backend run build
npm --prefix backend start
```

API documentation remains available at `http://127.0.0.1:8000/docs`, with the API
contract at `/openapi.json` and an alternative view at `/redoc`.

## Configuration and local data

Copy `backend/.env.example` to `backend/.env` to customize the backend. The development,
start, and migration commands load that optional file using Node's built-in environment
support. Existing process environment variables take precedence.

| Variable              | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `INVENTORY_DATA_DIR`  | Absolute data directory, default repository-relative `InventoryData/node/` |
| `INVENTORY_DB_PATH`   | Absolute database path, default `<data directory>/inventory.db`            |
| `INVENTORY_HOST`      | Bind address, default `127.0.0.1`                                          |
| `INVENTORY_PORT`      | Backend port, default `8000`                                               |
| `INVENTORY_LOG_LEVEL` | Application log level, default `INFO`                                      |
| `VITE_API_BASE_URL`   | Frontend backend URL, default `http://127.0.0.1:8000`                      |

Configure the frontend through `frontend/.env`, based on `frontend/.env.example`.
Backend storage paths support `~/` and are independent of the current working directory.
The backend permits requests from `http://localhost:5173` and `http://127.0.0.1:5173`.

The frontend initially selects German for a `de` system locale and English for all
other locales. Language and appearance can be changed from the sidebar. Both choices
are stored locally in the browser and restored on the next visit.

```text
InventoryData/node/
├── inventory.db
├── attachments/
└── logs/
    └── inventory-manager.log
```

This data directory is excluded from version control. The Node data location is
retained from the migration so already-created Node data stays available. The old
Python database is not imported or used. Attachments and synchronization remain
preparations, not implemented features.

See [backend documentation](backend/README.md) for migration commands and API behavior.

## Quality checks

Run the complete quality check from the repository root:

```bash
npm run check
```

It executes typecheck, lint, tests, build, and finally `prettier --check .`.
The format check only reads files. The other checks delegate to the frontend and
backend packages; backend tests use `node:test`, frontend tests use Vitest.

Tests use synthetic data. The frontend client integration test starts Express with
a temporary database and local port. HTTP tests require an environment permitting
local socket communication.

Individual checks remain available in each package, for example:

```bash
npm --prefix backend run test
npm --prefix frontend run test
npm run format:check
```
