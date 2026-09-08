from pathlib import Path

from pytest import MonkeyPatch

from app.core.paths import ensure_app_dir_exists


def test_ensure_app_dir_exists_creates_directories(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    data_dir = tmp_path / "InventoryData"
    monkeypatch.setenv("INVENTORY_DATA_DIR", str(data_dir))

    paths = ensure_app_dir_exists()

    assert paths.data_dir == data_dir
    assert paths.attachments_dir.exists()
    assert paths.logs_dir.exists()
