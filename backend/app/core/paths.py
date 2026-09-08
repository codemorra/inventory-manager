"""Define and create local application storage paths."""

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = PROJECT_ROOT / "InventoryData"


@dataclass(frozen=True)
class AppPaths:
    """Store resolved paths for local application data.

    Attributes:
        data_dir: Root directory for local application data.
    """

    data_dir: Path

    @property
    def database_path(self) -> Path:
        """Return the path to the SQLite database file.

        Returns:
            Path: Local database file path.
        """
        return self.data_dir / "inventory.db"

    @property
    def attachments_dir(self) -> Path:
        """Return the directory for attachment files.

        Returns:
            Path: Local attachment directory path.
        """
        return self.data_dir / "attachments"

    @property
    def logs_dir(self) -> Path:
        """Return the directory for application log files.

        Returns:
            Path: Local log directory path.
        """
        return self.data_dir / "logs"

    @property
    def log_file(self) -> Path:
        """Return the primary application log file path.

        Returns:
            Path: Local application log file path.
        """
        return self.logs_dir / "inventory-manager.log"


def get_app_paths() -> AppPaths:
    """Resolve local paths from configuration or development defaults.

    Returns:
        AppPaths: Resolved local application paths.
    """
    configured_data_dir = os.getenv("INVENTORY_DATA_DIR")

    if configured_data_dir:
        data_dir = Path(configured_data_dir).expanduser().resolve()
    else:
        data_dir = DEFAULT_DATA_DIR

    return AppPaths(data_dir=data_dir)


def ensure_app_directories() -> AppPaths:
    """Create required local application directories.

    Returns:
        AppPaths: Paths for the created directories.
    """
    paths = get_app_paths()

    paths.data_dir.mkdir(parents=True, exist_ok=True)
    paths.attachments_dir.mkdir(parents=True, exist_ok=True)
    paths.logs_dir.mkdir(parents=True, exist_ok=True)

    return paths
