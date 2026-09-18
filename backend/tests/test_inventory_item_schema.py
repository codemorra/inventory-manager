"""Test inventory item API schemas."""

from app.schemas.inventory_item import InventoryItemCreate, InventoryItemUpdate


def test_inventory_item_create_defaults_to_empty_values() -> None:
    """Verify that item creation defaults to no field values."""
    assert InventoryItemCreate().values == []


def test_inventory_item_update_accepts_field_values() -> None:
    """Verify that item updates accept structured field values."""
    data = InventoryItemUpdate.model_validate(
        {"values": [{"field_id": "field-1", "value": "Example"}]},
    )

    assert data.values[0].field_id == "field-1"
    assert data.values[0].value == "Example"
