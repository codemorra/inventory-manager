import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = PROJECT_ROOT / "InventoryData"


@dataclass(frozen=True)
class AppPaths:
    data_dir: Path

    @property
    def database_path(self) -> Path:
        return self.data_dir / "inventory.db"

    @property
    def attachments_dir(self) -> Path:
        return self.data_dir / "attachments"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def log_file(self) -> Path:
        return self.logs_dir / "inventory-manager.log"


def get_app_paths() -> AppPaths:
    configured_data_dir = os.getenv("INVENTORY_DATA_DIR")

    if configured_data_dir:
        data_dir = Path(configured_data_dir).expanduser().resolve()
    else:
        data_dir = DEFAULT_DATA_DIR

    return AppPaths(data_dir=data_dir)


def ensure_app_dir_exists() -> AppPaths:
    paths = get_app_paths()

    paths.data_dir.mkdir(parents=True, exist_ok=True)
    paths.attachments_dir.mkdir(parents=True, exist_ok=True)
    paths.logs_dir.mkdir(parents=True, exist_ok=True)

    return paths
