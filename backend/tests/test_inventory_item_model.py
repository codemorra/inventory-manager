from app.models.inventory_item import InventoryItem
from app.models.inventory_item_value import InventoryItemValue


def test_inventory_item_model_defines_expected_columns() -> None:
    assert InventoryItem.__tablename__ == "inventory_items"
    assert set(InventoryItem.__table__.columns.keys()) == {
        "id",
        "inventory_id",
        "created_at",
        "updated_at",
        "deleted_at",
    }


def test_inventory_item_value_model_defines_expected_columns() -> None:
    assert InventoryItemValue.__tablename__ == "inventory_item_values"
    assert set(InventoryItemValue.__table__.columns.keys()) == {
        "id",
        "item_id",
        "field_id",
        "value",
        "created_at",
        "updated_at",
        "deleted_at",
    }
