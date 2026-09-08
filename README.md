# inventory-manager

`inventory-manager` is a local desktop application for flexible management of personal inventories. Users can create inventories with custom fields and manage entries and their associated files.

The application is being developed with a React/TypeScript frontend, a local FastAPI backend, and SQLite. Cloud synchronization is not part of the current development phase.

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
uvicorn app.main:app --reload
```

The backend is available at `http://127.0.0.1:8000`.
Use `http://127.0.0.1:8000/health` to verify that it is running.
