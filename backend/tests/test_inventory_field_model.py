"""Test the inventory field database model."""

from app.core.field_types import InventoryFieldType
from app.models.inventory_field import InventoryField
from app.models.inventory_field_option import InventoryFieldOption


def test_inventory_field_model_defines_expected_columns() -> None:
    """Verify that the inventory field model defines required columns."""
    assert InventoryField.__tablename__ == "inventory_fields"
    assert set(InventoryField.__table__.columns.keys()) == {
        "id",
        "inventory_id",
        "name",
        "field_type",
        "max_length",
        "position",
        "created_at",
        "updated_at",
        "deleted_at",
    }


def test_inventory_field_option_model_defines_expected_columns() -> None:
    assert InventoryFieldOption.__tablename__ == "inventory_field_options"
    assert set(InventoryFieldOption.__table__.columns.keys()) == {
        "id",
        "field_id",
        "name",
        "position",
        "created_at",
        "updated_at",
        "deleted_at",
    }


def test_inventory_field_type_defines_mvp_values() -> None:
    assert [field_type.value for field_type in InventoryFieldType] == [
        "text",
        "number",
        "boolean",
        "date",
        "time",
        "datetime",
        "duration",
        "select",
        "multiselect",
    ]
