# Run with Docker

You need Docker with the Compose plugin, or Docker Desktop using Linux containers. The image is built locally from this repository.

## Start and stop

From the repository root:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:8000`. The app is accessible only from the Docker host by default. To use another port, change the mapping in `compose.yaml`, for example to `127.0.0.1:8080:8000`.

To stop and start the app:

```bash
docker compose stop
docker compose start
```

The container has up to five minutes to shut down cleanly. Let large uploads, backups or storage moves finish before stopping it. The health status in `docker compose ps` uses `/health`; API documentation is available at `/docs`.

## Your data

Compose stores settings, inventories, attachments, backups and logs in the `inventory-manager-data` volume, mounted at `/app/InventoryData`:

```text
config/    # Settings
data/      # Database and attachments
backups/   # Backup archives
logs/      # Application logs
temp/      # Temporary files
```

Rebuilding or removing the container preserves this volume. **`docker compose down -v` deletes it and its contents.** Keep the same Compose project name and volume mapping when updating.

The first start creates an empty installation. Existing data in the repository and local `.env` files are not included in the image.

Storage paths entered in Settings refer to the container. Keep them below `/app/InventoryData`, or mount additional persistent directories before choosing other locations. Files outside these mounts are lost when the container is replaced.

Automatic backups are disabled by default and use UTC in the container. To use another timezone, add this under `services.app` in `compose.yaml` and recreate the container:

```yaml
environment:
  TZ: Europe/Berlin
```

## Use a host directory

For a new installation, create a directory with write permissions for the container user (`10001:10001`):

```bash
sudo install -d -o 10001 -g 10001 -m 0755 .local/docker/InventoryData
```

Replace the app's volume entry in `compose.yaml` with:

```yaml
volumes:
  - ./.local/docker/InventoryData:/app/InventoryData
```

For an existing installation, stop the app and copy its storage contents to the new directory first, preserving ownership and permissions. Include any custom data and backup locations, and keep the original files until you have checked the result. Changing the mount alone does not move your data.

## Update and back up

Before updating, create and download a backup in Settings. It contains the database and attachments. Settings are separate: for a complete copy, stop the app and also save `config/` and any custom data or backup directories. Logs are optional; temporary files and runtime locks are not backup content. See [application backups](application-backup.md).

After obtaining the desired source version, run:

```bash
docker compose up --build -d
```

Check the container's health and your saved data afterward. Startup applies database migrations automatically. An older image does not undo them; restoring a backup currently requires a matching database schema and migration history.

## Logs

For startup errors and container output:

```bash
docker compose logs app
```

For the application log:

```bash
docker compose exec app tail -n 100 /app/InventoryData/logs/inventory-manager.log
```
