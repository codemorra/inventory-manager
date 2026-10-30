# Inventory Manager

Inventory Manager is a local application for organizing personal inventories. Create lists with your own fields, manage items and attachments, and reuse inventory structures as templates.

Run it in a desktop window on Linux or Windows, or in your browser with Docker. Data stays in your local storage.

![Cable inventory with typed field values and grouped inventories in the sidebar](docs/screenshots/inventory.png)

## Features

- **Custom inventories:** Define the fields you need for each list, such as an item's name, quantity, purchase date or storage location. Choose from text, numbers, dates, times, durations, selections, checkboxes, links, files and automatic IDs.
- **Organization and templates:** Arrange inventories in groups and reuse their field structures as templates for new lists.
- **Search and editing:** Find items using text search and field-specific filters, sort by columns, and edit individual items or several table cells together.
- **Table layouts:** Choose visible columns, adjust their widths, wrap long text and show image previews. Each inventory keeps its own view settings.
- **Attachments and exchange:** Keep copies of documents and photos with your items. Export an inventory with its attached files as a ZIP archive and import it into another installation.
- **Backups and storage:** Create and restore data backups, schedule daily or weekly backups, and choose where data and backup files are stored.
- **Appearance and language:** Switch between German and English, light and dark themes, and several accent colors.

## How it works

Create an inventory through **New > New inventory** in the sidebar. Each inventory has its own fields: a cable collection might use connector type, length, quantity and a photo, while a tool inventory might use model, purchase date and storage location. Open **Inventory settings** beside the title to add and arrange these fields, mark required values and define selection options.

Add entries with **New item**. Use a row's edit action to change an item, or the table's pencil action to edit several cells and save the changes together. Search and filters narrow the list, column headings control sorting, and **View** lets you adjust which information the table shows.

Drag inventories into sidebar groups to organize larger collections. If several lists need the same fields, save an inventory's structure as a template and select it when creating the next list. Templates provide a starting point; each inventory can then be edited independently.

Attach files to keep managed copies with an item. Export an inventory from its sidebar context menu to share or move the list with its saved items and files. Choose **New > Import inventory** to select an archive, review its contents and create an independent copy. Use **Settings > Backups** to back up or restore data across all inventories.

See the [user guide](docs/usage.md) for field types, table controls, templates and backup instructions.

## Technology

The frontend uses React and TypeScript, with Vite for development and builds and Tailwind CSS for styling. The backend runs on Node.js with Express, Drizzle and SQLite. Electron provides the desktop window and starts the backend as a separate Node.js process.

Desktop runtime and local builds have been tested on Linux and Windows x64; the Docker runtime has been tested on Linux x64.

## Getting started

Clone the repository:

```bash
git clone https://github.com/codemorra/inventory-manager.git
cd inventory-manager
```

Choose a desktop build or use Docker. The project distributes source code and build scripts; finished applications and Docker images are built locally.

### Desktop builds

Install Node.js 24 or later and npm, then build on the target operating system:

```bash
npm run build:desktop
```

This creates a self-contained Linux AppImage or portable Windows EXE in `dist/onefile/`. For an application directory instead:

```bash
npm run build:desktop:dir
```

The directory is created in `dist/onedir/inventory-manager/`; keep all its files together. It generally starts faster because the runtime files are already unpacked. The Windows single-file EXE extracts them at startup; a Linux AppImage normally mounts its contents and can extract them when needed.

Both formats include their runtime and need no separate Node.js installation to run. Builds require internet access and replace the project's installed dependencies using `npm ci`.

See [desktop setup](docs/desktop.md) for prerequisites, output paths and platform notes.

### Docker

With Docker and the Compose plugin installed:

```bash
docker compose up --build -d
```

Open `http://localhost:8000`. Settings, data, attachments, backups and logs persist in a Docker volume. See [Docker setup](docs/docker.md) for storage, timezone configuration and host-directory mounts.

## Data and backups

Repository runs store data in `InventoryData/`. Desktop builds use `%LOCALAPPDATA%\InventoryManager\` on Windows and `$XDG_DATA_HOME/inventory-manager/` on Linux, normally `~/.local/share/inventory-manager/`. Docker uses its persistent volume.

Data and backup folders can be moved in **Settings > Storage locations**. Settings and logs stay at the application root. Files attached to items are independent copies; changing the original file does not update the attachment.

Create or restore data backups in **Settings > Backups**. Automatic backups are optional and run only while the application is running. Backups contain the database and managed attachments; application settings and logs are separate. See [storage and configuration](docs/storage.md) for paths and complete installation copies.

## Updates

Use **Settings > About > Check for updates** to check GitHub releases. Updates are installed manually.

Before updating, create and download a data backup, then close the application. Update the source checkout to the desired version. For desktop builds, repeat the build command and replace the old file or application directory. For development checkouts, reinstall dependencies as described under [Development](#development) and start again. For Docker, run `docker compose up --build -d` again.

Saved data remains in its selected location. Startup applies database migrations; using an older application does not reverse them. Backup restoration requires a matching database schema and migration history.

## Development

With Node.js 24 or later and npm installed, install the dependencies from the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix desktop ci
```

Start the backend in one terminal:

```bash
npm run dev:backend
```

Start the frontend in another:

```bash
npm run dev:frontend
```

The backend defaults to `http://127.0.0.1:8000`; the frontend normally uses `http://localhost:5173`. API documentation is served at `/docs`, `/redoc` and `/openapi.json` on the backend.

To run the desktop app during development instead:

```bash
npm run dev:desktop
```

This builds the application and opens Electron with its own backend on a free loopback port. Stop any development backend using the same data directory first.

Run the full quality check from the repository root:

```bash
npm run check
```

See the [development guide](docs/development.md) for project structure, individual checks and desktop smoke tests, and the [backend README](backend/README.md) for migrations and API maintenance.

This project was developed with the assistance of generative AI tools. Suggestions were reviewed, modified and tested as part of development.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

Third-party tools, libraries and runtimes are subject to their own licenses. Their license terms and notices also apply when redistributing locally built applications or images.
