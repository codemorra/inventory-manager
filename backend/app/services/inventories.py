"""Provide inventory business logic."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.schemas.inventory import InventoryCreate, InventoryUpdate


class InventoryNotFoundError(Exception):
    """Indicate that an active inventory could not be found."""

    pass


def utc_now() -> datetime:
    """Return the current UTC timestamp.

    Returns:
        datetime: Current UTC timestamp.
    """
    return datetime.now(UTC)


def create_inventory(session: Session, data: InventoryCreate) -> Inventory:
    """Create and persist an inventory.

    Args:
        session: Active database session.
        data: Validated inventory creation data.

    Returns:
        Inventory: Persisted inventory.
    """
    inventory = Inventory(
        name=data.name,
        description=data.description,
    )

    session.add(inventory)
    session.commit()
    session.refresh(inventory)

    return inventory


def list_inventories(session: Session) -> list[Inventory]:
    """Return active inventories ordered by name.

    Args:
        session: Active database session.

    Returns:
        list[Inventory]: Active inventories.
    """
    statement = select(Inventory).where(Inventory.deleted_at.is_(None)).order_by(Inventory.name)

    return list(session.scalars(statement))


def get_inventory(session: Session, inventory_id: str) -> Inventory:
    """Retrieve an active inventory by identifier.

    Args:
        session: Active database session.
        inventory_id: Inventory UUID.

    Returns:
        Inventory: Matching active inventory.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
    """
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
    """Update supplied fields of an active inventory.

    Args:
        session: Active database session.
        inventory_id: Inventory UUID.
        data: Validated inventory update data.

    Returns:
        Inventory: Updated inventory.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
    """
    inventory = get_inventory(session, inventory_id)

    if data.name is not None:
        inventory.name = data.name

    if "description" in data.model_fields_set:
        inventory.description = data.description

    session.commit()
    session.refresh(inventory)

    return inventory


def delete_inventory(session: Session, inventory_id: str) -> None:
    """Clear inventory content and create a deletion tombstone.

    Args:
        session: Active database session.
        inventory_id: Inventory UUID.

    Returns:
        None.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
    """
    inventory = get_inventory(session, inventory_id)

    inventory.name = ""
    inventory.description = None
    inventory.deleted_at = utc_now()

    session.commit()
