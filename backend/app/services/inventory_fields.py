from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.inventory_field import InventoryField
from app.schemas.inventory_field import InventoryFieldCreate, InventoryFieldUpdate
from app.services.inventories import get_inventory, utc_now


class InventoryFieldNotFoundError(Exception):
    pass


def create_inventory_field(
    session: Session,
    inventory_id: str,
    data: InventoryFieldCreate,
) -> InventoryField:
    get_inventory(session, inventory_id)

    position_statement = (
        select(func.count())
        .select_from(InventoryField)
        .where(
            InventoryField.inventory_id == inventory_id,
            InventoryField.deleted_at.is_(None),
        )
    )
    position = session.scalar(position_statement) or 0

    inventory_field = InventoryField(
        inventory_id=inventory_id,
        name=data.name,
        field_type="text",
        position=position,
    )

    session.add(inventory_field)
    session.commit()
    session.refresh(inventory_field)

    return inventory_field


def list_inventory_fields(
    session: Session,
    inventory_id: str,
) -> list[InventoryField]:
    get_inventory(session, inventory_id)

    statement = (
        select(InventoryField)
        .where(
            InventoryField.inventory_id == inventory_id,
            InventoryField.deleted_at.is_(None),
        )
        .order_by(InventoryField.position)
    )

    return list(session.scalars(statement))


def get_inventory_field(
    session: Session,
    inventory_id: str,
    field_id: str,
) -> InventoryField:
    get_inventory(session, inventory_id)

    statement = select(InventoryField).where(
        InventoryField.id == field_id,
        InventoryField.inventory_id == inventory_id,
        InventoryField.deleted_at.is_(None),
    )
    inventory_field = session.scalar(statement)

    if inventory_field is None:
        raise InventoryFieldNotFoundError(field_id)

    return inventory_field


def update_inventory_field(
    session: Session,
    inventory_id: str,
    field_id: str,
    data: InventoryFieldUpdate,
) -> InventoryField:
    inventory_field = get_inventory_field(session, inventory_id, field_id)

    if data.name is not None:
        inventory_field.name = data.name

    if data.position is not None:
        inventory_field.position = data.position

    session.commit()
    session.refresh(inventory_field)

    return inventory_field


def delete_inventory_field(
    session: Session,
    inventory_id: str,
    field_id: str,
) -> None:
    inventory_field = get_inventory_field(session, inventory_id, field_id)

    inventory_field.name = ""
    inventory_field.deleted_at = utc_now()

    session.commit()
