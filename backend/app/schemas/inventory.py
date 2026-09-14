"""Define API schemas for inventory data."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_name(value: str) -> str:
    """Trim and validate an inventory name.

    Args:
        value: Inventory name to normalize.

    Returns:
        str: Trimmed inventory name.

    Raises:
        ValueError: If the name is empty after trimming.
    """
    normalized_value = value.strip()

    if not normalized_value:
        raise ValueError("Name must not be empty.")

    return normalized_value


class InventoryCreate(BaseModel):
    """Validate data required to create an inventory."""

    name: str = Field(max_length=255)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        """Validate an inventory name.

        Args:
            value: Inventory name to validate.

        Returns:
            str: Normalized inventory name.
        """
        return _normalize_name(value)


class InventoryUpdate(BaseModel):
    """Validate optional fields used to update an inventory."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        """Validate an optional inventory name.

        Args:
            value: Inventory name to validate, if supplied.

        Returns:
            str | None: Normalized name or an omitted value.
        """
        if value is None:
            return None

        return _normalize_name(value)


class InventoryRead(BaseModel):
    """Represent an active inventory in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
