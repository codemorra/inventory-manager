"""Define the inventory item value database model."""

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.inventory import utc_now


class InventoryItemValue(Base):
    """Store a typed value assigned to an inventory item field."""

    __tablename__ = "inventory_item_values"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    item_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("inventory_items.id"),
        nullable=False,
    )
    field_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("inventory_fields.id"),
        nullable=False,
    )
    value: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
