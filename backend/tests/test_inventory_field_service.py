from collections.abc import Generator

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database.base import Base
from app.models.inventory_field import InventoryField
from app.schemas.inventory import InventoryCreate
from app.schemas.inventory_field import InventoryFieldCreate, InventoryFieldUpdate
from app.services.inventories import create_inventory
from app.services.inventory_fields import (
    InventoryFieldNotFoundError,
    create_inventory_field,
    delete_inventory_field,
    get_inventory_field,
    list_inventory_fields,
    update_inventory_field,
)


@pytest.fixture
def session() -> Generator[Session]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as database_session:
        yield database_session

    engine.dispose()


def test_create_inventory_field_uses_text_type_and_next_position(
    session: Session,
) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Cables"))

    first_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="  Brand  "),
    )
    second_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="Length"),
    )

    assert first_field.name == "Brand"
    assert first_field.field_type == "text"
    assert first_field.position == 0
    assert second_field.position == 1


def test_create_inventory_field_rejects_whitespace_only_name() -> None:
    with pytest.raises(ValidationError):
        InventoryFieldCreate(name="   ")


def test_list_inventory_fields_returns_active_fields_in_position_order(
    session: Session,
) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Cables"))
    first_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="Brand"),
    )
    second_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="Length"),
    )

    fields = list_inventory_fields(session, inventory.id)

    assert fields == [first_field, second_field]


def test_update_inventory_field_changes_supplied_values(session: Session) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Cables"))
    inventory_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="Brand"),
    )

    updated_field = update_inventory_field(
        session,
        inventory.id,
        inventory_field.id,
        InventoryFieldUpdate(name="Manufacturer", position=2),
    )

    assert updated_field.name == "Manufacturer"
    assert updated_field.position == 2
    assert updated_field.field_type == "text"


def test_delete_inventory_field_clears_content_and_creates_tombstone(
    session: Session,
) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Cables"))
    inventory_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="Brand"),
    )

    delete_inventory_field(session, inventory.id, inventory_field.id)

    deleted_field = session.get(InventoryField, inventory_field.id)

    assert deleted_field is not None
    assert deleted_field.name == ""
    assert deleted_field.deleted_at is not None
    assert list_inventory_fields(session, inventory.id) == []


def test_get_inventory_field_rejects_deleted_and_unknown_fields(
    session: Session,
) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Cables"))
    inventory_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="Brand"),
    )
    delete_inventory_field(session, inventory.id, inventory_field.id)

    with pytest.raises(InventoryFieldNotFoundError):
        get_inventory_field(session, inventory.id, inventory_field.id)

    with pytest.raises(InventoryFieldNotFoundError):
        get_inventory_field(session, inventory.id, "unknown-field-id")
