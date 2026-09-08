from pathlib import Path

from pytest import MonkeyPatch

from app.core.paths import ensure_app_directories


def test_ensure_app_directories_creates_directories(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    """Verify that required local application directories are created.

    Args:
        tmp_path: Temporary directory provided by pytest.
        monkeypatch: Pytest helper for environment configuration.
    """
    data_dir = tmp_path / "InventoryData"
    monkeypatch.setenv("INVENTORY_DATA_DIR", str(data_dir))

    paths = ensure_app_directories()

    assert paths.data_dir == data_dir
    assert paths.attachments_dir.exists()
    assert paths.logs_dir.exists()
