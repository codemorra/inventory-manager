from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.database.session import get_session
from app.main import create_app


@pytest.fixture
def client() -> Generator[TestClient]:
    """Provide an API client backed by an isolated database.

    Yields:
        TestClient: Configured FastAPI test client.
    """
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    def get_test_session() -> Generator[Session]:
        with Session(engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = get_test_session

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    engine.dispose()


def test_create_and_get_inventory(client: TestClient) -> None:
    """Verify that an inventory can be created and retrieved.

    Args:
        client: Configured FastAPI test client.
    """
    create_response = client.post(
        "/inventories",
        json={
            "name": "Cables",
            "description": "Cable collection",
        },
    )

    assert create_response.status_code == 201

    created_inventory = create_response.json()

    get_response = client.get(f"/inventories/{created_inventory['id']}")

    assert get_response.status_code == 200
    assert get_response.json()["name"] == "Cables"


def test_list_inventories(client: TestClient) -> None:
    """Verify that active inventories are listed by name.

    Args:
        client: Configured FastAPI test client.
    """
    client.post("/inventories", json={"name": "Cables"})
    client.post("/inventories", json={"name": "Tools"})

    response = client.get("/inventories")

    assert response.status_code == 200
    assert [inventory["name"] for inventory in response.json()] == [
        "Cables",
        "Tools",
    ]


def test_update_inventory(client: TestClient) -> None:
    """Verify that an inventory can be updated.

    Args:
        client: Configured FastAPI test client.
    """
    create_response = client.post("/inventories", json={"name": "Cables"})
    inventory_id = create_response.json()["id"]

    response = client.patch(
        f"/inventories/{inventory_id}",
        json={"description": "Updated description"},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Cables"
    assert response.json()["description"] == "Updated description"


def test_delete_inventory_creates_not_found_response(client: TestClient) -> None:
    """Verify that deleted inventories return the standard not-found response.

    Args:
        client: Configured FastAPI test client.
    """
    create_response = client.post("/inventories", json={"name": "Cables"})
    inventory_id = create_response.json()["id"]

    delete_response = client.delete(f"/inventories/{inventory_id}")
    get_response = client.get(f"/inventories/{inventory_id}")

    assert delete_response.status_code == 204
    assert get_response.status_code == 404
    assert get_response.json()["detail"]["code"] == "inventory_not_found"
