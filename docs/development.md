# Development

## Setup

Install Node.js 24 or later and npm, then install each package from the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix desktop ci
```

The root, frontend, backend and desktop packages have separate lockfiles. `better-sqlite3` requires its native installation step; see the [backend README](../backend/README.md).

Start the backend and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

The default addresses are `http://127.0.0.1:8000` and `http://localhost:5173`. Check backend readiness at `/health`. Local browser requests are allowed from `localhost:5173` and `127.0.0.1:5173`.

For Electron, use `npm run dev:desktop` instead. It builds the shared application and starts its own backend on a free loopback port. Stop any other backend using the same storage first. See [desktop setup](desktop.md) and [storage configuration](storage.md) for runtime differences.

## Project structure

| Path                           | Contents                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| `frontend/src/`                | React pages, components, hooks, API clients, types and DE/EN translations |
| `frontend/test/`               | Vitest and Testing Library tests                                          |
| `backend/src/`                 | Express routes, domain services, repositories and OpenAPI source          |
| `backend/test/`                | Backend unit and HTTP integration tests                                   |
| `backend/drizzle/`             | Database migrations and their metadata                                    |
| `desktop/src/`                 | Electron lifecycle, backend controller and window behavior                |
| `desktop/scripts/`, `scripts/` | Runtime preparation, builds, checks and version generation                |
| `desktop/test/`                | Unit tests and Electron smoke tests                                       |
| `assets/icons/`                | Shared SVG artwork and derived desktop icons                              |
| `docs/`                        | User guides, runtime setup and developer references                       |

Generated code, installed modules, application data, `build/`, `dist/` and `.local/` are excluded from Git.

## Quality checks

From the repository root:

```bash
npm run check
```

This runs type checking, linting, tests, builds and `prettier --check .` across the project. Individual stages are available as `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run format:check`. Package-specific scripts can be run with `npm --prefix frontend`, `npm --prefix backend` or `npm --prefix desktop`.

Frontend tests use Vitest and Testing Library; backend and desktop unit tests use `node:test`. Tests use synthetic data and temporary storage. HTTP integration tests need local socket access. Do not point tests or experimental migrations at a real installation.

## Desktop smoke tests

To exercise the real Electron runtime with temporary data:

```bash
npm --prefix desktop run prepare:runtime
npm --prefix desktop run smoke
```

The smoke test covers startup, shutdown, restart, files, backups and window behavior. It runs headlessly and does not verify compositor-specific details such as Wayland taskbar icons.

To test a local build:

```bash
npm --prefix desktop run smoke:package -- path/to/application
```

Pass two application paths to check data preservation when replacing one build with another. These tests use temporary data and remove it afterward.

## Maintenance references

- [Backend setup and migrations](../backend/README.md)
- [API behavior and revision checks](backend-api.md)
- [Inventory archive format](inventory-archive.md)
- [Backup format and restore recovery](application-backup.md)
- [Application versioning](app-versioning.md)
- [Icon source and regeneration](../assets/icons/README.md)

Keep user-facing changes translated in German and English. Update the relevant guide when behavior changes and the OpenAPI source when the API changes. Markdown prose uses one source line per paragraph.
