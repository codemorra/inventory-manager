"""Expose inventory API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.session import get_session
from app.schemas.inventory import InventoryCreate, InventoryRead, InventoryUpdate
from app.services import inventories as inventory_service

router = APIRouter(prefix="/inventories", tags=["inventories"])

SessionDependency = Annotated[Session, Depends(get_session)]


def _raise_not_found() -> None:
    """Raise the standard inventory-not-found HTTP response.

    Returns:
        None.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "code": "inventory_not_found",
            "message": "Inventory not found.",
        },
    )


@router.post(
    "",
    response_model=InventoryRead,
    status_code=status.HTTP_201_CREATED,
)
def create_inventory(
    data: InventoryCreate,
    session: SessionDependency,
) -> InventoryRead:
    """Create an inventory.

    Args:
        data: Validated inventory creation data.
        session: Active database session.

    Returns:
        InventoryRead: Created inventory response.
    """
    inventory = inventory_service.create_inventory(session, data)

    return InventoryRead.model_validate(inventory)


@router.get("", response_model=list[InventoryRead])
def list_inventories(session: SessionDependency) -> list[InventoryRead]:
    """List active inventories.

    Args:
        session: Active database session.

    Returns:
        list[InventoryRead]: Active inventory responses.
    """
    inventories = inventory_service.list_inventories(session)

    return [InventoryRead.model_validate(inventory) for inventory in inventories]


@router.get("/{inventory_id}", response_model=InventoryRead)
def get_inventory(
    inventory_id: str,
    session: SessionDependency,
) -> InventoryRead:
    """Retrieve an inventory by identifier.

    Args:
        inventory_id: Inventory UUID.
        session: Active database session.

    Returns:
        InventoryRead: Matching inventory response.
    """
    try:
        inventory = inventory_service.get_inventory(session, inventory_id)
    except inventory_service.InventoryNotFoundError:
        _raise_not_found()

    return InventoryRead.model_validate(inventory)


@router.patch("/{inventory_id}", response_model=InventoryRead)
def update_inventory(
    inventory_id: str,
    data: InventoryUpdate,
    session: SessionDependency,
) -> InventoryRead:
    """Update an inventory.

    Args:
        inventory_id: Inventory UUID.
        data: Validated inventory update data.
        session: Active database session.

    Returns:
        InventoryRead: Updated inventory response.
    """
    try:
        inventory = inventory_service.update_inventory(
            session,
            inventory_id,
            data,
        )
    except inventory_service.InventoryNotFoundError:
        _raise_not_found()

    return InventoryRead.model_validate(inventory)


@router.delete(
    "/{inventory_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_inventory(
    inventory_id: str,
    session: SessionDependency,
) -> None:
    """Delete an inventory using a tombstone.

    Args:
        inventory_id: Inventory UUID.
        session: Active database session.

    Returns:
        None.
    """
    try:
        inventory_service.delete_inventory(session, inventory_id)
    except inventory_service.InventoryNotFoundError:
        _raise_not_found()
