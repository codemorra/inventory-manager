"""Define API schemas for inventory field data."""

from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.field_types import InventoryFieldType


def _normalize_name(value: str) -> str:
    """Trim and validate a user-defined name."""
    normalized_value = value.strip()

    if not normalized_value:
        raise ValueError("Name must not be empty.")

    return normalized_value


class InventoryFieldOptionCreate(BaseModel):
    """Validate data required to create an inventory field option."""

    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _normalize_name(value)


class InventoryFieldOptionUpdate(BaseModel):
    """Validate optional values used to update an inventory field option."""

    name: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return _normalize_name(value)


class InventoryFieldCreate(BaseModel):
    """Validate data required to create a configured inventory field."""

    name: str = Field(min_length=1, max_length=255)
    field_type: InventoryFieldType = InventoryFieldType.TEXT
    max_length: int | None = Field(default=None, ge=1, le=10_000)
    options: list[InventoryFieldOptionCreate] = Field(
        default_factory=list,
        max_length=100,
    )

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _normalize_name(value)

    @model_validator(mode="after")
    def validate_configuration(self) -> Self:
        """Validate configuration that depends on the selected field type."""
        selectable_types = {
            InventoryFieldType.SELECT,
            InventoryFieldType.MULTISELECT,
        }

        if self.field_type is InventoryFieldType.TEXT:
            self.max_length = self.max_length or 255
        elif self.max_length is not None:
            raise ValueError("Only text fields can define a maximum length.")

        if self.field_type in selectable_types:
            if not self.options:
                raise ValueError(
                    "Select and multiselect fields require at least one option.",
                )

            option_names = [option.name.casefold() for option in self.options]

            if len(option_names) != len(set(option_names)):
                raise ValueError("Field options must have unique names.")
        elif self.options:
            raise ValueError(
                "Only select and multiselect fields can define options.",
            )

        return self


class InventoryFieldUpdate(BaseModel):
    """Validate optional values used to update an inventory field."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    position: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return _normalize_name(value)


class InventoryFieldOptionRead(BaseModel):
    """Represent an active inventory field option in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    field_id: str
    name: str
    position: int
    created_at: datetime
    updated_at: datetime


class InventoryFieldRead(BaseModel):
    """Represent an active configured inventory field in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_id: str
    name: str
    field_type: InventoryFieldType
    max_length: int | None
    options: list[InventoryFieldOptionRead] = Field(default_factory=list)
    position: int
    created_at: datetime
    updated_at: datetime
