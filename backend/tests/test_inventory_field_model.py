"""Test the inventory field database model."""

from app.models.inventory_field import InventoryField


def test_inventory_field_model_defines_expected_columns() -> None:
    """Verify that the inventory field model defines required columns."""
    assert InventoryField.__tablename__ == "inventory_fields"
    assert set(InventoryField.__table__.columns.keys()) == {
        "id",
        "inventory_id",
        "name",
        "field_type",
        "position",
        "created_at",
        "updated_at",
        "deleted_at",
    }
