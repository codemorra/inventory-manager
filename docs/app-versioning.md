# Application versioning

The root `package.json` defines the application version. The private frontend, backend and desktop packages have no independent application versions.

Versions use three numeric components (`X.Y.Z`), and GitHub release tags use `vX.Y.Z`. The update checker compares components numerically, so `1.10.0` is newer than `1.9.0`. Database migrations, settings documents and archive formats have separate versions.

## Change the version

Update `version` in the root `package.json`, then synchronize the lockfile:

```bash
npm install --package-lock-only --ignore-scripts
```

Rebuild the application afterward. A GitHub release provides the version reference for manual update checks. Releases contain source archives, without uploaded application binaries or Docker images.

## Generated modules

`scripts/generate-app-version.mjs` writes `src/generated/app-version.ts` in the selected packages. Code imports `APP_VERSION` from that module. Generated files are excluded from Git and are only rewritten when their contents change.

Frontend and backend `dev`, `typecheck`, `test` and `build` scripts generate their version modules through npm lifecycle hooks. Frontend tests generate both modules because their integration test starts the backend. Desktop typecheck, test and build scripts generate its module; desktop startup prepares and builds the runtime first.

When invoking tools directly, generate the modules first:

```bash
node scripts/generate-app-version.mjs
node scripts/generate-app-version.mjs desktop
```

The first command targets frontend and backend. Explicit package names can also be passed to the script.

## Build metadata

Compiled code keeps its build version instead of reading the root package at runtime. Desktop packaging takes its version from the same root package.

The served `/openapi.json` injects `APP_VERSION` into the source template's empty `info.version`; `/docs` and `/redoc` use this served document. Keep the source template's version empty.
