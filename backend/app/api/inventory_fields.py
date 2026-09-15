"""Expose inventory field API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.session import get_session
from app.schemas.inventory_field import (
    InventoryFieldCreate,
    InventoryFieldRead,
    InventoryFieldUpdate,
)
from app.services import inventories as inventory_service
from app.services import inventory_fields as inventory_field_service

router = APIRouter(
    prefix="/inventories/{inventory_id}/fields",
    tags=["inventory fields"],
)

SessionDependency = Annotated[Session, Depends(get_session)]


def _raise_inventory_not_found() -> None:
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


def _raise_inventory_field_not_found() -> None:
    """Raise the standard inventory-field-not-found HTTP response.

    Returns:
        None.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "code": "inventory_field_not_found",
            "message": "Inventory field not found.",
        },
    )


@router.post(
    "",
    response_model=InventoryFieldRead,
    status_code=status.HTTP_201_CREATED,
)
def create_inventory_field(
    inventory_id: str,
    data: InventoryFieldCreate,
    session: SessionDependency,
) -> InventoryFieldRead:
    """Create an inventory field.

    Args:
        inventory_id: Parent inventory UUID.
        data: Validated inventory field creation data.
        session: Active database session.

    Returns:
        InventoryFieldRead: Created inventory field response.
    """
    try:
        inventory_field = inventory_field_service.create_inventory_field(
            session,
            inventory_id,
            data,
        )
    except inventory_service.InventoryNotFoundError:
        _raise_inventory_not_found()

    return InventoryFieldRead.model_validate(inventory_field)


@router.get("", response_model=list[InventoryFieldRead])
def list_inventory_fields(
    inventory_id: str,
    session: SessionDependency,
) -> list[InventoryFieldRead]:
    """List active inventory fields.

    Args:
        inventory_id: Parent inventory UUID.
        session: Active database session.

    Returns:
        list[InventoryFieldRead]: Active inventory field responses.
    """
    try:
        inventory_fields = inventory_field_service.list_inventory_fields(
            session,
            inventory_id,
        )
    except inventory_service.InventoryNotFoundError:
        _raise_inventory_not_found()

    return [
        InventoryFieldRead.model_validate(inventory_field) for inventory_field in inventory_fields
    ]


@router.get("/{field_id}", response_model=InventoryFieldRead)
def get_inventory_field(
    inventory_id: str,
    field_id: str,
    session: SessionDependency,
) -> InventoryFieldRead:
    """Retrieve an inventory field by identifier.

    Args:
        inventory_id: Parent inventory UUID.
        field_id: Inventory field UUID.
        session: Active database session.

    Returns:
        InventoryFieldRead: Matching inventory field response.
    """
    try:
        inventory_field = inventory_field_service.get_inventory_field(
            session,
            inventory_id,
            field_id,
        )
    except inventory_service.InventoryNotFoundError:
        _raise_inventory_not_found()
    except inventory_field_service.InventoryFieldNotFoundError:
        _raise_inventory_field_not_found()

    return InventoryFieldRead.model_validate(inventory_field)


@router.patch("/{field_id}", response_model=InventoryFieldRead)
def update_inventory_field(
    inventory_id: str,
    field_id: str,
    data: InventoryFieldUpdate,
    session: SessionDependency,
) -> InventoryFieldRead:
    """Update an inventory field.

    Args:
        inventory_id: Parent inventory UUID.
        field_id: Inventory field UUID.
        data: Validated inventory field update data.
        session: Active database session.

    Returns:
        InventoryFieldRead: Updated inventory field response.
    """
    try:
        inventory_field = inventory_field_service.update_inventory_field(
            session,
            inventory_id,
            field_id,
            data,
        )
    except inventory_service.InventoryNotFoundError:
        _raise_inventory_not_found()
    except inventory_field_service.InventoryFieldNotFoundError:
        _raise_inventory_field_not_found()

    return InventoryFieldRead.model_validate(inventory_field)


@router.delete(
    "/{field_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_inventory_field(
    inventory_id: str,
    field_id: str,
    session: SessionDependency,
) -> None:
    """Delete an inventory field using a tombstone.

    Args:
        inventory_id: Parent inventory UUID.
        field_id: Inventory field UUID.
        session: Active database session.

    Returns:
        None.
    """
    try:
        inventory_field_service.delete_inventory_field(
            session,
            inventory_id,
            field_id,
        )
    except inventory_service.InventoryNotFoundError:
        _raise_inventory_not_found()
    except inventory_field_service.InventoryFieldNotFoundError:
        _raise_inventory_field_not_found()
