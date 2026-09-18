"""Define API schemas for inventory item data."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class InventoryItemValueInput(BaseModel):
    """Validate an incoming inventory item field value."""

    field_id: str
    value: Any


class InventoryItemCreate(BaseModel):
    """Validate data required to create an inventory item."""

    values: list[InventoryItemValueInput] = Field(default_factory=list)


class InventoryItemUpdate(BaseModel):
    """Validate replacement values for an inventory item."""

    values: list[InventoryItemValueInput] = Field(default_factory=list)


class InventoryItemValueRead(BaseModel):
    """Represent an active inventory item value in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    field_id: str
    value: Any
    created_at: datetime
    updated_at: datetime


class InventoryItemRead(BaseModel):
    """Represent an active inventory item in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_id: str
    values: list[InventoryItemValueRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
