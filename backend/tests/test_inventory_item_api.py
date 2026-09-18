from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.database.session import get_session
from app.main import create_app


def test_inventory_items_can_be_created_updated_and_deleted() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    def test_session() -> Generator[Session]:
        with Session(engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = test_session
    with TestClient(app) as client:
        inventory_id = client.post("/inventories", json={"name": "Games"}).json()["id"]
        field_id = client.post(
            f"/inventories/{inventory_id}/fields", json={"name": "Title", "max_length": 120}
        ).json()["id"]
        created = client.post(
            f"/inventories/{inventory_id}/items",
            json={"values": [{"field_id": field_id, "value": "Catan"}]},
        )
        assert created.status_code == 201
        item_id = created.json()["id"]
        updated = client.patch(
            f"/inventories/{inventory_id}/items/{item_id}",
            json={"values": [{"field_id": field_id, "value": "Carcassonne"}]},
        )
        assert updated.status_code == 200
        assert updated.json()["values"][0]["value"] == "Carcassonne"
        assert client.delete(f"/inventories/{inventory_id}/items/{item_id}").status_code == 204
    app.dependency_overrides.clear()
    engine.dispose()
