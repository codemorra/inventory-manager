from collections.abc import Generator

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database.base import Base
from app.models.inventory import Inventory
from app.schemas.inventory import InventoryCreate, InventoryUpdate
from app.services.inventories import (
    InventoryNotFoundError,
    create_inventory,
    delete_inventory,
    get_inventory,
    list_inventories,
    update_inventory,
)


@pytest.fixture
def session() -> Generator[Session]:
    """Provide an isolated in-memory database session.

    Yields:
        Session: Active test database session.
    """
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as database_session:
        yield database_session

    engine.dispose()


def test_create_inventory_normalizes_name(session: Session) -> None:
    """Verify that created inventory names are normalized.

    Args:
        session: Active test database session.
    """
    inventory = create_inventory(
        session,
        InventoryCreate(
            name="  Cables  ",
            description="Cable collection",
        ),
    )

    assert inventory.name == "Cables"
    assert inventory.description == "Cable collection"
    assert inventory.id
    assert inventory.created_at is not None
    assert inventory.updated_at is not None


def test_create_inventory_rejects_whitespace_only_name() -> None:
    """Verify that whitespace-only inventory names are rejected."""
    with pytest.raises(ValidationError):
        InventoryCreate(name="   ")


def test_list_inventories_excludes_deleted_inventories(session: Session) -> None:
    """Verify that deleted inventories are excluded from lists.

    Args:
        session: Active test database session.
    """
    active_inventory = create_inventory(session, InventoryCreate(name="Cables"))
    deleted_inventory = create_inventory(session, InventoryCreate(name="Tools"))

    delete_inventory(session, deleted_inventory.id)

    inventories = list_inventories(session)

    assert inventories == [active_inventory]


def test_update_inventory_changes_only_supplied_fields(session: Session) -> None:
    """Verify that updates preserve fields not supplied by the request.

    Args:
        session: Active test database session.
    """
    inventory = create_inventory(
        session,
        InventoryCreate(
            name="Cables",
            description="Initial description",
        ),
    )

    updated_inventory = update_inventory(
        session,
        inventory.id,
        InventoryUpdate(description="Updated description"),
    )

    assert updated_inventory.name == "Cables"
    assert updated_inventory.description == "Updated description"


def test_delete_inventory_clears_content_and_creates_tombstone(
    session: Session,
) -> None:
    """Verify that deletion clears content and records a tombstone.

    Args:
        session: Active test database session.
    """
    inventory = create_inventory(
        session,
        InventoryCreate(
            name="Cables",
            description="Cable collection",
        ),
    )

    delete_inventory(session, inventory.id)

    deleted_inventory = session.get(Inventory, inventory.id)

    assert deleted_inventory is not None
    assert deleted_inventory.name == ""
    assert deleted_inventory.description is None
    assert deleted_inventory.deleted_at is not None


def test_get_inventory_rejects_deleted_and_unknown_inventories(
    session: Session,
) -> None:
    """Verify that deleted and unknown inventories cannot be retrieved.

    Args:
        session: Active test database session.
    """
    inventory = create_inventory(session, InventoryCreate(name="Cables"))
    delete_inventory(session, inventory.id)

    with pytest.raises(InventoryNotFoundError):
        get_inventory(session, inventory.id)

    with pytest.raises(InventoryNotFoundError):
        get_inventory(session, "unknown-inventory-id")
