from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class InventoryItemValueInput(BaseModel):
    field_id: str
    value: Any


class InventoryItemCreate(BaseModel):
    values: list[InventoryItemValueInput] = Field(default_factory=list)


class InventoryItemUpdate(BaseModel):
    values: list[InventoryItemValueInput] = Field(default_factory=list)


class InventoryItemValueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    field_id: str
    value: Any
    created_at: datetime
    updated_at: datetime


class InventoryItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_id: str
    values: list[InventoryItemValueRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
