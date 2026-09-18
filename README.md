# inventory-manager

`inventory-manager` is a local application for flexible management of personal inventories.

The application is being developed with a React/TypeScript frontend, a local FastAPI backend, and SQLite.

## Current features

- Create, view, edit, and delete inventory lists
- Define, rename, and delete configurable fields for inventory lists
- Configure text limits and select or multiselect options per field
- Support text, number, boolean, date, time, datetime, duration, select, and multiselect field types
- Create local inventory items with typed field values
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

### Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend is available at the local URL shown by Vite, usually `http://localhost:5173`.

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
