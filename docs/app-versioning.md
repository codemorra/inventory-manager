# Application versioning

The root `package.json` is the authoritative application-version source. The private frontend, backend and desktop packages have no independent application versions.

## Generated modules

`scripts/generate-app-version.mjs` reads the root version and writes `src/generated/app-version.ts` in the selected packages. Application code imports `APP_VERSION` from that module. Generated modules are ignored by Git; unchanged content is not rewritten.

The frontend and backend `dev`, `typecheck`, `test` and `build` scripts generate their module through npm lifecycle hooks, including when invoked directly with `npm --prefix frontend` or `npm --prefix backend`. The frontend test command generates both modules because its integration test starts the backend directly. To generate both modules explicitly, run:

```bash
node scripts/generate-app-version.mjs
```

When invoking tools directly instead of using npm scripts, generate the required modules first.

The desktop package generates its own version module through the same lifecycle hooks. To generate it directly, run `node scripts/generate-app-version.mjs desktop`.

## Build metadata

The compiled backend retains its generated build version and does not read the root package at runtime. `/openapi.json`, used by `/docs` and `/redoc`, injects that version into the source template's empty `info.version`. The source template is not the standalone served specification.

To change the application version, update the root `package.json` and synchronize its lockfile with `npm install --package-lock-only --ignore-scripts`, then rebuild the application.

Application versions are independent of database migrations, settings-document versions and archive-format versions.
