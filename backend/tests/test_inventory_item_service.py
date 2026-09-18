from collections.abc import Generator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database.base import Base
from app.models.inventory_item_value import InventoryItemValue
from app.schemas.inventory import InventoryCreate
from app.schemas.inventory_field import InventoryFieldCreate
from app.schemas.inventory_item import InventoryItemCreate, InventoryItemUpdate
from app.services.inventories import create_inventory
from app.services.inventory_fields import create_inventory_field
from app.services.inventory_items import (
    InventoryItemValueValidationError,
    create_inventory_item,
    delete_inventory_item,
    update_inventory_item,
)


@pytest.fixture
def session() -> Generator[Session]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as database_session:
        yield database_session
    engine.dispose()


def test_inventory_item_values_are_created_replaced_and_tombstoned(session: Session) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Games"))
    title = create_inventory_field(
        session, inventory.id, InventoryFieldCreate(name="Title", max_length=120)
    )
    item = create_inventory_item(
        session,
        inventory.id,
        InventoryItemCreate.model_validate(
            {"values": [{"field_id": title.id, "value": "Catan"}]},
        ),
    )
    update_inventory_item(
        session,
        inventory.id,
        item.id,
        InventoryItemUpdate.model_validate(
            {"values": [{"field_id": title.id, "value": "Carcassonne"}]},
        ),
    )
    values = list(
        session.scalars(select(InventoryItemValue).where(InventoryItemValue.item_id == item.id))
    )
    assert len(values) == 2
    assert sum(value.deleted_at is not None for value in values) == 1
    delete_inventory_item(session, inventory.id, item.id)
    assert all(value.deleted_at is not None and value.value is None for value in values)


def test_inventory_item_rejects_invalid_values(session: Session) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Games"))
    title = create_inventory_field(
        session, inventory.id, InventoryFieldCreate(name="Title", max_length=3)
    )
    with pytest.raises(InventoryItemValueValidationError):
        create_inventory_item(
            session,
            inventory.id,
            InventoryItemCreate.model_validate(
                {"values": [{"field_id": title.id, "value": "Catan"}]},
            ),
        )
