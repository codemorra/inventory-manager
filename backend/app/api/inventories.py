from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.session import get_session
from app.schemas.inventory import InventoryCreate, InventoryRead, InventoryUpdate
from app.services import inventories as inventory_service

router = APIRouter(prefix="/inventories", tags=["inventories"])

SessionDependency = Annotated[Session, Depends(get_session)]


def _raise_not_found() -> None:
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
    inventory = inventory_service.create_inventory(session, data)

    return InventoryRead.model_validate(inventory)


@router.get("", response_model=list[InventoryRead])
def list_inventories(session: SessionDependency) -> list[InventoryRead]:
    inventories = inventory_service.list_inventories(session)

    return [InventoryRead.model_validate(inventory) for inventory in inventories]


@router.get("/{inventory_id}", response_model=InventoryRead)
def get_inventory(
    inventory_id: str,
    session: SessionDependency,
) -> InventoryRead:
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
    try:
        inventory_service.delete_inventory(session, inventory_id)
    except inventory_service.InventoryNotFoundError:
        _raise_not_found()
