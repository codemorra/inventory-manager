from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.schemas.inventory import InventoryCreate, InventoryUpdate


class InventoryNotFoundError(Exception):
    pass


def utc_now() -> datetime:
    return datetime.now(UTC)


def create_inventory(session: Session, data: InventoryCreate) -> Inventory:
    inventory = Inventory(
        name=data.name,
        description=data.description,
    )

    session.add(inventory)
    session.commit()
    session.refresh(inventory)

    return inventory


def list_inventories(session: Session) -> list[Inventory]:
    statement = select(Inventory).where(Inventory.deleted_at.is_(None)).order_by(Inventory.name)

    return list(session.scalars(statement))


def get_inventory(session: Session, inventory_id: str) -> Inventory:
    statement = select(Inventory).where(
        Inventory.id == inventory_id,
        Inventory.deleted_at.is_(None),
    )
    inventory = session.scalar(statement)

    if inventory is None:
        raise InventoryNotFoundError(inventory_id)

    return inventory


def update_inventory(
    session: Session,
    inventory_id: str,
    data: InventoryUpdate,
) -> Inventory:
    inventory = get_inventory(session, inventory_id)

    if data.name is not None:
        inventory.name = data.name

    if "description" in data.model_fields_set:
        inventory.description = data.description

    session.commit()
    session.refresh(inventory)

    return inventory


def delete_inventory(session: Session, inventory_id: str) -> None:
    inventory = get_inventory(session, inventory_id)

    inventory.name = ""
    inventory.description = None
    inventory.deleted_at = utc_now()

    session.commit()
