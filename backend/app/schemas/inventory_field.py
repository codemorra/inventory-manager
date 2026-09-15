"""Define API schemas for inventory field data."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InventoryFieldCreate(BaseModel):
    """Validate data required to create an inventory field."""

    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        """Trim and validate an inventory field name.

        Args:
            value: Inventory field name to normalize.

        Returns:
            str: Normalized inventory field name.

        Raises:
            ValueError: If the name is empty after trimming.
        """
        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Name must not be empty.")

        return normalized_value


class InventoryFieldUpdate(BaseModel):
    """Validate optional data used to update an inventory field."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    position: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        """Trim and validate an optional inventory field name.

        Args:
            value: Inventory field name to normalize, if supplied.

        Returns:
            str | None: Normalized name or an omitted value.

        Raises:
            ValueError: If the name is empty after trimming.
        """
        if value is None:
            return None

        normalized_value = value.strip()

        if not normalized_value:
            raise ValueError("Name must not be empty.")

        return normalized_value


class InventoryFieldRead(BaseModel):
    """Represent an active inventory field in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_id: str
    name: str
    field_type: str
    position: int
    created_at: datetime
    updated_at: datetime
