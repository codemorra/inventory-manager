from datetime import date, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.field_types import InventoryFieldType
from app.models.inventory_field import InventoryField
from app.models.inventory_field_option import InventoryFieldOption
from app.models.inventory_item import InventoryItem
from app.models.inventory_item_value import InventoryItemValue
from app.schemas.inventory_item import InventoryItemCreate, InventoryItemUpdate
from app.services.inventories import get_inventory, utc_now


class InventoryItemNotFoundError(Exception):
    pass


class InventoryItemValueValidationError(Exception):
    pass


def _active_fields(session: Session, inventory_id: str) -> dict[str, InventoryField]:
    statement = select(InventoryField).where(
        InventoryField.inventory_id == inventory_id,
        InventoryField.deleted_at.is_(None),
    )
    return {field.id: field for field in session.scalars(statement)}


def _validate_value(
    session: Session,
    field: InventoryField,
    value: Any,
) -> None:
    field_type = InventoryFieldType(field.field_type)

    if field_type is InventoryFieldType.TEXT:
        if not isinstance(value, str) or len(value) > (field.max_length or 255):
            raise InventoryItemValueValidationError(field.id)
    elif field_type is InventoryFieldType.NUMBER:
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise InventoryItemValueValidationError(field.id)
    elif field_type is InventoryFieldType.BOOLEAN:
        if not isinstance(value, bool):
            raise InventoryItemValueValidationError(field.id)
    elif field_type is InventoryFieldType.DATE:
        if not isinstance(value, str):
            raise InventoryItemValueValidationError(field.id)
        date.fromisoformat(value)
    elif field_type is InventoryFieldType.TIME:
        if not isinstance(value, str):
            raise InventoryItemValueValidationError(field.id)
        time.fromisoformat(value)
    elif field_type is InventoryFieldType.DATETIME:
        if not isinstance(value, str):
            raise InventoryItemValueValidationError(field.id)
        datetime.fromisoformat(value)
    elif field_type is InventoryFieldType.DURATION:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise InventoryItemValueValidationError(field.id)
    else:
        option_ids = value if field_type is InventoryFieldType.MULTISELECT else [value]
        if (
            not isinstance(option_ids, list)
            or not option_ids
            or not all(isinstance(item, str) for item in option_ids)
        ):
            raise InventoryItemValueValidationError(field.id)
        statement = select(InventoryFieldOption.id).where(
            InventoryFieldOption.field_id == field.id,
            InventoryFieldOption.id.in_(option_ids),
            InventoryFieldOption.deleted_at.is_(None),
        )
        if len(set(session.scalars(statement))) != len(set(option_ids)):
            raise InventoryItemValueValidationError(field.id)


def _create_values(session: Session, item_id: str, inventory_id: str, values: list[Any]) -> None:
    fields = _active_fields(session, inventory_id)
    field_ids = [value.field_id for value in values]
    if len(field_ids) != len(set(field_ids)) or not set(field_ids).issubset(fields):
        raise InventoryItemValueValidationError("field")
    for item_value in values:
        field = fields[item_value.field_id]
        _validate_value(session, field, item_value.value)
        session.add(InventoryItemValue(item_id=item_id, field_id=field.id, value=item_value.value))


def create_inventory_item(
    session: Session, inventory_id: str, data: InventoryItemCreate
) -> InventoryItem:
    get_inventory(session, inventory_id)
    item = InventoryItem(inventory_id=inventory_id)
    session.add(item)
    session.flush()
    _create_values(session, item.id, inventory_id, data.values)
    session.commit()
    session.refresh(item)
    return item


def get_inventory_item(session: Session, inventory_id: str, item_id: str) -> InventoryItem:
    get_inventory(session, inventory_id)
    statement = select(InventoryItem).where(
        InventoryItem.id == item_id,
        InventoryItem.inventory_id == inventory_id,
        InventoryItem.deleted_at.is_(None),
    )
    item = session.scalar(statement)
    if item is None:
        raise InventoryItemNotFoundError(item_id)
    return item


def update_inventory_item(
    session: Session, inventory_id: str, item_id: str, data: InventoryItemUpdate
) -> InventoryItem:
    item = get_inventory_item(session, inventory_id, item_id)
    statement = select(InventoryItemValue).where(
        InventoryItemValue.item_id == item.id, InventoryItemValue.deleted_at.is_(None)
    )
    for value in session.scalars(statement):
        value.value = None
        value.deleted_at = utc_now()
    _create_values(session, item.id, inventory_id, data.values)
    session.commit()
    session.refresh(item)
    return item


def delete_inventory_item(session: Session, inventory_id: str, item_id: str) -> None:
    item = get_inventory_item(session, inventory_id, item_id)
    item.deleted_at = utc_now()
    statement = select(InventoryItemValue).where(
        InventoryItemValue.item_id == item.id, InventoryItemValue.deleted_at.is_(None)
    )
    for value in session.scalars(statement):
        value.value = None
        value.deleted_at = utc_now()
    session.commit()
