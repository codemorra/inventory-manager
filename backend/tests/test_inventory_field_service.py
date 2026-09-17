from collections.abc import Generator

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.field_types import InventoryFieldType
from app.database.base import Base
from app.models.inventory_field import InventoryField
from app.models.inventory_field_option import InventoryFieldOption
from app.schemas.inventory import InventoryCreate
from app.schemas.inventory_field import (
    InventoryFieldCreate,
    InventoryFieldOptionCreate,
    InventoryFieldUpdate,
)
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


def test_create_inventory_field_uses_default_text_configuration(
    session: Session,
) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Cables"))

    inventory_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(name="  Brand  "),
    )

    assert inventory_field.name == "Brand"
    assert inventory_field.field_type == InventoryFieldType.TEXT
    assert inventory_field.max_length == 255
    assert inventory_field.position == 0


def test_create_text_field_uses_custom_maximum_length(session: Session) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Games"))

    inventory_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(
            name="Title",
            field_type=InventoryFieldType.TEXT,
            max_length=120,
        ),
    )

    assert inventory_field.max_length == 120


def test_create_select_field_persists_ordered_options(session: Session) -> None:
    inventory = create_inventory(session, InventoryCreate(name="Games"))

    inventory_field = create_inventory_field(
        session,
        inventory.id,
        InventoryFieldCreate(
            name="Played",
            field_type=InventoryFieldType.SELECT,
            options=[
                InventoryFieldOptionCreate(name="Not started"),
                InventoryFieldOptionCreate(name="In progress"),
                InventoryFieldOptionCreate(name="Completed"),
            ],
        ),
    )

    statement = (
        select(InventoryFieldOption)
        .where(InventoryFieldOption.field_id == inventory_field.id)
        .order_by(InventoryFieldOption.position)
    )
    options = list(session.scalars(statement))

    assert inventory_field.field_type == InventoryFieldType.SELECT
    assert inventory_field.max_length is None
    assert [option.name for option in options] == [
        "Not started",
        "In progress",
        "Completed",
    ]
    assert [option.position for option in options] == [0, 1, 2]


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (
            {
                "name": "Price",
                "field_type": InventoryFieldType.NUMBER,
                "max_length": 10,
            },
            "Only text fields can define a maximum length.",
        ),
        (
            {
                "name": "Genre",
                "field_type": InventoryFieldType.MULTISELECT,
            },
            "Select and multiselect fields require at least one option.",
        ),
        (
            {
                "name": "Completed",
                "field_type": InventoryFieldType.BOOLEAN,
                "options": [{"name": "Yes"}],
            },
            "Only select and multiselect fields can define options.",
        ),
        (
            {
                "name": "Platform",
                "field_type": InventoryFieldType.SELECT,
                "options": [{"name": "PC"}, {"name": "pc"}],
            },
            "Field options must have unique names.",
        ),
    ],
)
def test_inventory_field_configuration_rejects_invalid_values(
    data: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        InventoryFieldCreate.model_validate(data)


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
    assert updated_field.field_type == InventoryFieldType.TEXT
    assert updated_field.max_length == 255


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
