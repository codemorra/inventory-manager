"""Provide inventory field business logic."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.inventory_field import InventoryField
from app.schemas.inventory_field import InventoryFieldCreate, InventoryFieldUpdate
from app.services.inventories import get_inventory, utc_now


class InventoryFieldNotFoundError(Exception):
    """Indicate that an active inventory field could not be found."""

    pass


def create_inventory_field(
    session: Session,
    inventory_id: str,
    data: InventoryFieldCreate,
) -> InventoryField:
    """Create and persist an inventory field with the default text type.

    Args:
        session: Active database session.
        inventory_id: Parent inventory UUID.
        data: Validated inventory field creation data.

    Returns:
        InventoryField: Persisted inventory field.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
    """
    get_inventory(session, inventory_id)

    # New fields are appended after all active fields in the same inventory.
    position_statement = (
        select(func.count())
        .select_from(InventoryField)
        .where(
            InventoryField.inventory_id == inventory_id,
            InventoryField.deleted_at.is_(None),
        )
    )
    position = session.scalar(position_statement) or 0

    # Additional field types will be introduced in a later feature.
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
    """Return active inventory fields ordered by position.

    Args:
        session: Active database session.
        inventory_id: Parent inventory UUID.

    Returns:
        list[InventoryField]: Active inventory fields.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
    """
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
    """Retrieve an active inventory field by identifier.

    Args:
        session: Active database session.
        inventory_id: Parent inventory UUID.
        field_id: Inventory field UUID.

    Returns:
        InventoryField: Matching active inventory field.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
        InventoryFieldNotFoundError: If no active field matches the identifier.
    """
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
    """Update supplied values of an active inventory field.

    Args:
        session: Active database session.
        inventory_id: Parent inventory UUID.
        field_id: Inventory field UUID.
        data: Validated inventory field update data.

    Returns:
        InventoryField: Updated inventory field.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
        InventoryFieldNotFoundError: If no active field matches the identifier.
    """
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
    """Clear an inventory field name and create a deletion tombstone.

    Args:
        session: Active database session.
        inventory_id: Parent inventory UUID.
        field_id: Inventory field UUID.

    Returns:
        None.

    Raises:
        InventoryNotFoundError: If no active inventory matches the identifier.
        InventoryFieldNotFoundError: If no active field matches the identifier.
    """
    inventory_field = get_inventory_field(session, inventory_id, field_id)

    # Preserve the record only as a synchronization tombstone.
    inventory_field.name = ""
    inventory_field.deleted_at = utc_now()

    session.commit()
