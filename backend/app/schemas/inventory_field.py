from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InventoryFieldCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Name must not be empty.")

        return normalized_value


class InventoryFieldUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    position: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Name must not be empty.")

        return normalized_value


class InventoryFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_id: str
    name: str
    field_type: str
    position: int
    created_at: datetime
    updated_at: datetime
