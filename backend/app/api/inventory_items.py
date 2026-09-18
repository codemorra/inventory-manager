from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_session
from app.models.inventory_item import InventoryItem
from app.models.inventory_item_value import InventoryItemValue
from app.schemas.inventory_item import (
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
    InventoryItemValueRead,
)
from app.services import inventories as inventory_service
from app.services import inventory_items as item_service

router = APIRouter(prefix="/inventories/{inventory_id}/items", tags=["inventory items"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _not_found(code: str, message: str) -> NoReturn:
    raise HTTPException(status_code=404, detail={"code": code, "message": message})


def _serialize(session: Session, item: object) -> InventoryItemRead:
    response = InventoryItemRead.model_validate(item)
    statement = select(InventoryItemValue).where(
        InventoryItemValue.item_id == response.id, InventoryItemValue.deleted_at.is_(None)
    )
    return response.model_copy(
        update={
            "values": [
                InventoryItemValueRead.model_validate(value) for value in session.scalars(statement)
            ]
        }
    )


@router.post("", response_model=InventoryItemRead, status_code=status.HTTP_201_CREATED)
def create_item(
    inventory_id: str, data: InventoryItemCreate, session: SessionDependency
) -> InventoryItemRead:
    try:
        return _serialize(session, item_service.create_inventory_item(session, inventory_id, data))
    except inventory_service.InventoryNotFoundError:
        _not_found("inventory_not_found", "Inventory not found.")
    except item_service.InventoryItemValueValidationError:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_inventory_item_value",
                "message": "Inventory item values are invalid.",
            },
        )


@router.get("", response_model=list[InventoryItemRead])
def list_items(inventory_id: str, session: SessionDependency) -> list[InventoryItemRead]:
    try:
        inventory_service.get_inventory(session, inventory_id)
    except inventory_service.InventoryNotFoundError:
        _not_found("inventory_not_found", "Inventory not found.")
    items = session.scalars(
        select(InventoryItem)
        .where(InventoryItem.inventory_id == inventory_id, InventoryItem.deleted_at.is_(None))
        .order_by(InventoryItem.created_at.desc())
    )
    return [_serialize(session, item) for item in items]


@router.get("/{item_id}", response_model=InventoryItemRead)
def get_item(inventory_id: str, item_id: str, session: SessionDependency) -> InventoryItemRead:
    try:
        return _serialize(session, item_service.get_inventory_item(session, inventory_id, item_id))
    except inventory_service.InventoryNotFoundError:
        _not_found("inventory_not_found", "Inventory not found.")
    except item_service.InventoryItemNotFoundError:
        _not_found("inventory_item_not_found", "Inventory item not found.")


@router.patch("/{item_id}", response_model=InventoryItemRead)
def update_item(
    inventory_id: str, item_id: str, data: InventoryItemUpdate, session: SessionDependency
) -> InventoryItemRead:
    try:
        return _serialize(
            session, item_service.update_inventory_item(session, inventory_id, item_id, data)
        )
    except inventory_service.InventoryNotFoundError:
        _not_found("inventory_not_found", "Inventory not found.")
    except item_service.InventoryItemNotFoundError:
        _not_found("inventory_item_not_found", "Inventory item not found.")
    except item_service.InventoryItemValueValidationError:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_inventory_item_value",
                "message": "Inventory item values are invalid.",
            },
        )


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(inventory_id: str, item_id: str, session: SessionDependency) -> None:
    try:
        item_service.delete_inventory_item(session, inventory_id, item_id)
    except inventory_service.InventoryNotFoundError:
        _not_found("inventory_not_found", "Inventory not found.")
    except item_service.InventoryItemNotFoundError:
        _not_found("inventory_item_not_found", "Inventory item not found.")
