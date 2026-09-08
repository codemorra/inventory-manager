import logging
import os
from logging.handlers import RotatingFileHandler

from app.core.paths import AppPaths

LOGGER_NAME = "inventory_manager"


def configure_logging(app_paths: AppPaths) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(os.getenv("INVENTORY_LOG_LEVEL", "INFO").upper())
    logger.propagate = False

    for handler in logger.handlers:
        logger.removeHandler(handler)
        handler.close()

    file_handler = RotatingFileHandler(
        app_paths.log_file,
        maxBytes=1_000_000,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"),
    )

    logger.addHandler(file_handler)

    return logger
