# Desktop setup

Inventory Manager uses Electron for the window and a separate Node.js process for the backend. Desktop builds support Linux and Windows x64. Build on the operating system where the application will run.

## Build locally

Install Node.js 24 or later, npm and `tar` capable of extracting the platform's Node archive (`.tar.gz` on Linux, `.zip` on Windows). Internet access is required for dependencies and runtimes.

From the repository root, choose one format:

```bash
npm run build:desktop
```

```bash
npm run build:desktop:dir
```

The commands install dependencies with `npm ci`, download and verify a pinned official Node.js runtime, build the application and check the packaged runtime files. Existing project `node_modules` directories are replaced.

| Format              | Output                                                        | Start                                 |
| ------------------- | ------------------------------------------------------------- | ------------------------------------- |
| Linux single file   | `dist/onefile/Inventory-Manager-<version>-linux-x64.AppImage` | Run the AppImage                      |
| Windows single file | `dist/onefile/Inventory-Manager-<version>-win-x64.exe`        | Run the EXE                           |
| Linux directory     | `dist/onedir/inventory-manager/`                              | Run `inventory-manager` inside it     |
| Windows directory   | `dist/onedir/inventory-manager/`                              | Run `Inventory Manager.exe` inside it |

Keep directory builds together with all their files. They generally start faster because the runtime files are already unpacked. The Windows single-file EXE extracts its contents on launch; Linux AppImages normally mount theirs, with extraction available as a fallback. Both formats include their runtime and need no separate Node.js installation to run. Finished builds stay in `dist/`; intermediate files stay in `build/`. Neither is committed or published by the project.

### Platform notes

On Linux, make the AppImage executable before starting it. If FUSE is unavailable, pass `--appimage-extract-and-run`. Native libraries can affect compatibility across distributions; test builds on the systems where you intend to use them.

The Linux window uses the shared PNG application icon. Wayland taskbar matching can also depend on an installed `.desktop` entry matching the application's `inventory-manager` identity. The app does not install a desktop entry automatically.

The Windows single-file EXE is portable and unsigned, so Windows may display a warning. It extracts its contents on startup, which can take time.

## Run from source

With Node.js 24 or later and npm installed, run from the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix desktop ci
npm run dev:desktop
```

The launcher builds the application and prepares `.local/desktop-runtime/`, reusing unchanged backend dependencies. It starts its own backend on a free loopback port. Stop any development backend using the same storage first. The launcher reads process environment variables rather than `backend/.env`.

Only one desktop instance uses an application root; starting it again activates the existing window. Closing the last window shuts down the backend and exits. Unsaved changes require confirmation. External links open in your browser, downloads use a Save As dialog, and window size, position and maximized state are saved.

## Data and updates

Source runs use the repository's `InventoryData/`. Desktop builds default to `%LOCALAPPDATA%\InventoryManager\` on Windows and `$XDG_DATA_HOME/inventory-manager/` on Linux, normally `~/.local/share/inventory-manager/`. `INVENTORY_DATA_DIR` selects a separate application root. See [storage configuration](storage.md) for paths, settings and backups.

Before updating, create and download a data backup and close the app. Obtain the desired source version, then rebuild and replace the old application file or entire directory. For source runs, reinstall dependencies with the commands above and start again. Data remains in its selected location.

Database migrations run at startup and are not undone by replacing the application with an older build. Restore requires a compatible database schema and migration history; see [application backups](application-backup.md).

## Build internals and checks

Packaged resources live under `resources/app-runtime/`, including backend production dependencies, the built frontend, Linux window icon and an ordinary Node.js runtime. `npm --prefix desktop run prepare:build-runtime` prepares these in `build/.work/runtime/`, verifies the Node download's SHA-256 checksum and uses its Node/npm versions to install compatible backend dependencies. Packaging verifies the prepared runtime files, including dependency license files.

See the [development guide](development.md#desktop-smoke-tests) for unit checks, runtime smoke tests and packaged replacement tests using temporary data.
