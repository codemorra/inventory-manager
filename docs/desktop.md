# Run with Electron

Electron displays the existing frontend in a desktop window. A separate Node.js process runs the backend, database, files and backups.

## Build a desktop application

On x64 Linux or Windows, install Node.js 24 or later and npm. From the repository root, build a single-file application:

```bash
npm run build:desktop
```

Alternatively, build an application directory:

```bash
npm run build:desktop:dir
```

Both commands install the project dependencies, download and verify the Node.js runtime, build the application and check the packaged runtime files. They require internet access and `tar` capable of extracting the platform's Node archive. Existing `node_modules` directories are replaced by `npm ci`.

The single-file `Inventory-Manager-<version>-linux-x64.AppImage` or `Inventory-Manager-<version>-win-x64.exe` is in `dist/onefile/`. The directory build is in `dist/onedir/inventory-manager/`; start `inventory-manager` on Linux or `Inventory Manager.exe` on Windows. Keep the entire directory together. Build intermediates are stored in `build/`; both directories are excluded from Git. Both formats contain their runtime; users do not need Node.js to start them. Builds are created locally and are not published by the project.

On Linux, make the AppImage executable before starting it. AppImage may require FUSE; if unavailable, start it with `--appimage-extract-and-run`. The Windows EXE is portable and unsigned, so Windows may display a warning. It extracts its contents on startup, which can take time.

Before updating, create a backup in Settings and close the application. Update the source, run the chosen build command again and replace the old application file or entire application directory. Settings, data and backups remain in their selected storage locations, not next to the executable. See [application backups](../backend/docs/application-backup.md) for restore compatibility.

## Start locally

With Node.js 24 or later and npm installed, run from the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix desktop ci
npm run dev:desktop
```

The start command builds the application and prepares its runtime in `.local/desktop-runtime/`. Unchanged backend dependencies are reused. The backend listens on a free local port and stops cleanly when you close the window. Unsaved changes require confirmation; starting again activates the existing window.

Web links open in your browser, and downloads use a Save As dialog. Window size and position are saved.

## Data and updates

Repository starts use the existing `InventoryData/`. Stop any development backend using that storage before starting Electron. Set `INVENTORY_DATA_DIR` to an absolute path for a separate installation. The desktop launcher reads process environment variables, not `backend/.env`.

Packaged-mode defaults are `%LOCALAPPDATA%\InventoryManager\` on Windows and `$XDG_DATA_HOME/inventory-manager/` on Linux, normally `~/.local/share/inventory-manager/`. Settings and logs stay at that root; data and backup folders can be changed in Settings. Packaged temporary files use the user's temporary storage. Repository temporary files remain under `InventoryData/temp/`.

Logs are in `logs/inventory-manager.log` and `logs/desktop.log`. Window preferences are separate in `config/window-state.json`.

Before updating the source, create a backup in Settings. Run `npm run dev:desktop` again afterward to rebuild; saved data stays in its selected storage location. See [application backups](../backend/docs/application-backup.md) for backup contents and restore compatibility.

## Checks

`npm run check` includes desktop type checking, linting and unit tests. To test the real Electron runtime with temporary data:

```bash
npm --prefix desktop run prepare:runtime
npm --prefix desktop run smoke
```

The smoke test checks startup, shutdown, restart, files, backups and window behavior without using your saved data.

To test a packaged application with temporary data, pass its path to:

```bash
npm --prefix desktop run smoke:package -- path/to/application
```

Pass an old and a new application path to check data preservation across replacement. The test starts both applications headlessly and removes its temporary data afterward.

`npm --prefix desktop run prepare:build-runtime` prepares a separate runtime for desktop packaging in `build/.work/runtime/`. It downloads the pinned official Node.js distribution, checks its SHA-256 checksum, and uses its Node and npm versions to install backend production dependencies.
