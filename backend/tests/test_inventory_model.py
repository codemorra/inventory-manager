from app.models.inventory import Inventory


def test_inventory_model_defines_expected_columns() -> None:
    assert Inventory.__tablename__ == "inventories"
    assert set(Inventory.__table__.columns.keys()) == {
        "id",
        "name",
        "description",
        "created_at",
        "updated_at",
        "deleted_at",
    }
