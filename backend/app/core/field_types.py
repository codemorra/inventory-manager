"""Define supported inventory field types."""

from enum import StrEnum


class InventoryFieldType(StrEnum):
    """Represent the field types supported by the MVP."""

    TEXT = "text"
    NUMBER = "number"
    BOOLEAN = "boolean"
    DATE = "date"
    TIME = "time"
    DATETIME = "datetime"
    DURATION = "duration"
    SELECT = "select"
    MULTISELECT = "multiselect"
