# inventory-manager

> This project is currently under development.

`inventory-manager` is a local application for flexible management of personal inventories.

Users can create inventory lists, define custom fields, and manage items with typed values. Each inventory has its own field configuration, including text limits and options for select and multiselect fields.

The application provides a browser-based interface built with React and TypeScript, a local FastAPI backend, and SQLite storage. Inventory lists and items are displayed in tables, with forms for creating and editing entries opened in dialogs.

## Current features

- Create, view, edit, and delete inventory lists
- Define, rename, and delete configurable fields for inventory lists
- Configure text limits and select or multiselect options per field
- Add, rename, and delete options for existing select and multiselect fields
- Support text, number, boolean, date, time, datetime, duration, select, and multiselect field types
- Create, view, edit, and delete local inventory items with typed field values
- Local SQLite storage with Alembic database migrations
- Local application logging
- Responsive light and dark UI styles based on Tailwind CSS

## Development

### Prerequisites

- Python 3.14 or later
- Node.js and npm

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

The backend is available at `http://127.0.0.1:8000`.
Use `http://127.0.0.1:8000/health` to verify that it is running.
Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend is available at the local URL shown by Vite, usually `http://localhost:5173`.

### Configuration

- `INVENTORY_DATA_DIR`: Override the backend's local data directory. Set this environment variable for both Alembic and the backend so that they use the same database.
- `INVENTORY_LOG_LEVEL`: Set the backend application log level (default: `INFO`).
- `VITE_API_BASE_URL`: Set the frontend's backend URL (default: `http://127.0.0.1:8000`). To configure it locally, copy `frontend/.env.example` to `frontend/.env` and adjust the value.

The backend allows frontend requests from `http://localhost:5173` and `http://127.0.0.1:5173`.

### Local application data

During development, local application data is stored in `InventoryData/` in the repository root:

```text
InventoryData/
├── inventory.db
├── attachments/
└── logs/
    └── inventory-manager.log
```

This directory is intentionally excluded from version control.

## Quality checks

### Backend

```bash
cd backend
source .venv/bin/activate
ruff format --check .
ruff check .
mypy app tests
pytest
alembic current
```

### Frontend

```bash
cd frontend
npm run lint
npm run test
npm run build
```
