"""Test inventory field API endpoints."""

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


def create_inventory(client: TestClient) -> str:
    """Create an inventory for field endpoint tests.

    Args:
        client: Configured FastAPI test client.

    Returns:
        str: Created inventory UUID.
    """
    response = client.post("/inventories", json={"name": "Cables"})

    assert response.status_code == 201

    inventory_id = response.json()["id"]
    assert isinstance(inventory_id, str)

    return inventory_id


def test_create_and_get_inventory_field(client: TestClient) -> None:
    """Verify that an inventory field can be created and retrieved.

    Args:
        client: Configured FastAPI test client.
    """
    inventory_id = create_inventory(client)

    create_response = client.post(
        f"/inventories/{inventory_id}/fields",
        json={
            "name": "Played",
            "field_type": "select",
            "options": [
                {"name": "Not started"},
                {"name": "Completed"},
            ],
        },
    )

    assert create_response.status_code == 201

    created_field = create_response.json()

    assert created_field["name"] == "Played"
    assert created_field["position"] == 0
    assert created_field["field_type"] == "select"
    assert created_field["max_length"] is None
    assert [option["name"] for option in created_field["options"]] == [
        "Not started",
        "Completed",
    ]
    get_response = client.get(
        f"/inventories/{inventory_id}/fields/{created_field['id']}",
    )

    assert get_response.status_code == 200
    assert get_response.json()["id"] == created_field["id"]


def test_list_inventory_fields(client: TestClient) -> None:
    """Verify that active inventory fields are listed.

    Args:
        client: Configured FastAPI test client.
    """
    inventory_id = create_inventory(client)

    client.post(
        f"/inventories/{inventory_id}/fields",
        json={"name": "Brand"},
    )
    client.post(
        f"/inventories/{inventory_id}/fields",
        json={"name": "Length"},
    )

    response = client.get(f"/inventories/{inventory_id}/fields")

    assert response.status_code == 200
    assert [field["name"] for field in response.json()] == [
        "Brand",
        "Length",
    ]


def test_update_inventory_field(client: TestClient) -> None:
    """Verify that an inventory field can be updated.

    Args:
        client: Configured FastAPI test client.
    """
    inventory_id = create_inventory(client)
    create_response = client.post(
        f"/inventories/{inventory_id}/fields",
        json={"name": "Brand"},
    )
    field_id = create_response.json()["id"]

    response = client.patch(
        f"/inventories/{inventory_id}/fields/{field_id}",
        json={"name": "Manufacturer", "position": 2},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Manufacturer"
    assert response.json()["position"] == 2
    assert response.json()["field_type"] == "text"


def test_delete_inventory_field_returns_not_found_afterwards(
    client: TestClient,
) -> None:
    """Verify that deleted inventory fields return a not-found response.

    Args:
        client: Configured FastAPI test client.
    """
    inventory_id = create_inventory(client)
    create_response = client.post(
        f"/inventories/{inventory_id}/fields",
        json={"name": "Brand"},
    )
    field_id = create_response.json()["id"]

    delete_response = client.delete(
        f"/inventories/{inventory_id}/fields/{field_id}",
    )
    get_response = client.get(
        f"/inventories/{inventory_id}/fields/{field_id}",
    )

    assert delete_response.status_code == 204
    assert get_response.status_code == 404
    assert get_response.json()["detail"]["code"] == "inventory_field_not_found"


def test_inventory_field_endpoints_reject_unknown_inventory(
    client: TestClient,
) -> None:
    """Verify that field endpoints reject an unknown inventory.

    Args:
        client: Configured FastAPI test client.
    """
    response = client.get("/inventories/unknown-inventory-id/fields")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "inventory_not_found"


def test_inventory_field_options_can_be_managed(client: TestClient) -> None:
    inventory_id = create_inventory(client)
    field_response = client.post(
        f"/inventories/{inventory_id}/fields",
        json={
            "name": "Genre",
            "field_type": "multiselect",
            "options": [{"name": "RPG"}],
        },
    )
    field_id = field_response.json()["id"]

    create_response = client.post(
        f"/inventories/{inventory_id}/fields/{field_id}/options",
        json={"name": "Strategy"},
    )
    option_id = create_response.json()["id"]

    update_response = client.patch(
        f"/inventories/{inventory_id}/fields/{field_id}/options/{option_id}",
        json={"name": "Turn-based"},
    )
    list_response = client.get(
        f"/inventories/{inventory_id}/fields/{field_id}/options",
    )
    delete_response = client.delete(
        f"/inventories/{inventory_id}/fields/{field_id}/options/{option_id}",
    )

    assert create_response.status_code == 201
    assert update_response.json()["name"] == "Turn-based"
    assert [option["name"] for option in list_response.json()] == [
        "RPG",
        "Turn-based",
    ]
    assert delete_response.status_code == 204


def test_text_field_option_creation_is_rejected(client: TestClient) -> None:
    inventory_id = create_inventory(client)
    field_response = client.post(
        f"/inventories/{inventory_id}/fields",
        json={"name": "Title"},
    )
    field_id = field_response.json()["id"]

    response = client.post(
        f"/inventories/{inventory_id}/fields/{field_id}/options",
        json={"name": "Invalid"},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == ("inventory_field_options_not_supported")


def test_deleted_inventory_field_option_is_not_listed(client: TestClient) -> None:
    inventory_id = create_inventory(client)
    field_response = client.post(
        f"/inventories/{inventory_id}/fields",
        json={
            "name": "Played",
            "field_type": "select",
            "options": [{"name": "Not started"}],
        },
    )
    field_id = field_response.json()["id"]
    option_id = field_response.json()["options"][0]["id"]

    client.delete(
        f"/inventories/{inventory_id}/fields/{field_id}/options/{option_id}",
    )
    response = client.get(
        f"/inventories/{inventory_id}/fields/{field_id}/options",
    )

    assert response.status_code == 200
    assert response.json() == []
