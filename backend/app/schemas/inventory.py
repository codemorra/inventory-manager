from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_name(value: str) -> str:
    normalized_value = value.strip()

    if not normalized_value:
        raise ValueError("Name must not be empty.")

    return normalized_value


class InventoryCreate(BaseModel):
    name: str = Field(max_length=255)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _normalize_name(value)


class InventoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return _normalize_name(value)


class InventoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
