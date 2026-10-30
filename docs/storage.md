# Storage and configuration

## Default locations

| Runtime               | Application root                                                                  |
| --------------------- | --------------------------------------------------------------------------------- |
| Repository runs       | `InventoryData/` in the repository                                                |
| Windows desktop build | `%LOCALAPPDATA%\InventoryManager\`                                                |
| Linux desktop build   | `$XDG_DATA_HOME/inventory-manager/`, normally `~/.local/share/inventory-manager/` |
| Docker Compose        | `/app/InventoryData` in the persistent volume                                     |

The default layout below that root is:

```text
config/settings.json     # Preferences, storage locations and backup policy
config/window-state.json # Desktop window position and size
data/inventory.db        # Inventories, items, templates and table views
data/attachments/        # Managed file copies
backups/                 # Data backup archives
logs/                    # Application and desktop logs
temp/                    # Temporary working files in repository and Docker runs
```

Desktop builds use an application-specific directory in the operating system's temporary storage instead of `<root>/temp/`. Completed or cancelled work is cleaned up; abandoned files are reconciled on a later startup.

The backend writes rotating logs to `logs/inventory-manager.log`; Electron also writes `logs/desktop.log`. Custom data and backup locations do not move settings or logs.

## Change storage locations

Use **Settings > Storage locations** to choose absolute data and backup paths. The data folder contains `inventory.db` and `attachments/`. Destinations must be absent or empty, with no overlap between application storage directories. **Use default** fills the corresponding input; confirming the change starts the move.

The application waits for active work, copies and verifies the files, then switches locations. Interrupted moves are recovered on startup. Keep enough free disk space for the copies and let the operation finish before closing the app.

In Docker, paths refer to the container. Choose locations inside persistent mounts; see [Docker storage](docker.md#your-data).

Directly editing the stored paths only selects directories at the next start; it does not move existing files. Use the interface to move an installation. Do not edit internal relocation or restore journals.

Only one backend or manual migration can use an application root at a time. Close a development backend before starting Electron with the same storage. The runtime lock in `config/.runtime-lock.sqlite` is released by the operating system when the process exits; deleting the file is not a recovery step.

## Back up an installation

Data backups from **Settings > Backups** contain SQLite and managed attachments, including templates and saved table views. They do not contain settings, window state, logs or automatic-backup history. See the [user guide](usage.md#backups-and-restore) for normal backup and restore steps and the [backup specification](application-backup.md) for validation and compatibility.

For a complete installation copy, close the application and copy `config/`, the selected data folder and any backup folders you want to keep. Exclude `config/.runtime-lock.sqlite` and its SQLite journal files. Logs are optional; temporary files are not backup content. Include a separately configured database path if one is used.

Keep these copies together with a record of the application version. A raw installation copy retains configured paths, so check them before using it on another machine. Do not copy an active SQLite database as an ordinary file while the app is writing to it.

## Environment variables

Backend development, compiled start and migration commands read optional `backend/.env`, based on [the example](../backend/.env.example). Process environment variables take precedence. The Electron launcher reads process environment variables directly and does not load that file. Docker uses the environment defined in [compose.yaml](../compose.yaml) and [Dockerfile](../Dockerfile).

| Variable                 | Purpose / default                                                                |
| ------------------------ | -------------------------------------------------------------------------------- |
| `INVENTORY_DATA_DIR`     | Absolute application root; defaults depend on the runtime above                  |
| `INVENTORY_DB_PATH`      | Absolute SQLite path; normally `<data folder>/inventory.db`                      |
| `INVENTORY_HOST`         | Backend bind address; `127.0.0.1` for standalone runs                            |
| `INVENTORY_PORT`         | Backend port; `8000` for standalone runs                                         |
| `INVENTORY_LOG_LEVEL`    | `DEBUG`, `INFO`, `WARNING`, `ERROR` or `CRITICAL`; default `INFO`                |
| `INVENTORY_FRONTEND_DIR` | Optional absolute path to built frontend files; enables combined browser serving |
| `VITE_API_BASE_URL`      | Frontend build/development setting; default `http://127.0.0.1:8000`              |

Storage paths support `~/`. An explicit `INVENTORY_DB_PATH` overrides the settings-based database location and disables data relocation, while backup relocation remains available. Electron chooses a free loopback port; desktop preparation and Docker builds use `/api` for frontend requests.

Frontend configuration belongs in `frontend/.env`, based on [its example](../frontend/.env.example). Changing a frontend build setting requires rebuilding.

## Storage API and recovery

`GET /storage-locations` returns the shared settings revision, active/default paths, `dataMovable`, `pending`, `cleanupPending` and `moveFailed`. `PUT` accepts `expected_revision`, `dataDirectory` and `backupsDirectory`; `DELETE` with `expected_revision` cancels an unexecuted recovery plan. Responses use `Cache-Control: no-store`. Stale revisions return 409 `application_settings_conflict`; existing plans, pending cleanup or an explicit data override return 409 `storage_location_conflict`; invalid, occupied or overlapping destinations return 422 `storage_location_invalid`.

Startup resolves settings and restore recovery before opening the application database or relocating storage. Missing settings create a version-1 document; invalid existing settings stop startup without resetting them. Stored locations are optional `storage.dataDirectory` and `storage.backupsDirectory` entries in `config/settings.json`. Preferences and location changes share its revision.

Live relocation drains requests, streams, service work and file cleanup before closing SQLite. Import/export sessions and confirmation receipts survive the switch. Private staging copies are hashed and SQLite is checked before publication; symbolic links and special files in moved directories are rejected. Originals are retained until the new settings are activated atomically.

A persisted journal recovers interrupted moves. Failures restore the original locations; incomplete post-activation cleanup is retried while the new locations stay active. If storage cannot safely reopen, requests fail with 503 rather than initializing an empty database. The lifetime lock remains held while SQLite is closed for relocation or restoration.
