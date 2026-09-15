from app.models.inventory_field import InventoryField


def test_inventory_field_model_defines_expected_columns() -> None:
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
