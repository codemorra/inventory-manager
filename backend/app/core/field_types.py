from enum import StrEnum


class InventoryFieldType(StrEnum):
    TEXT = "text"
    NUMBER = "number"
    BOOLEAN = "boolean"
    DATE = "date"
    TIME = "time"
    DATETIME = "datetime"
    DURATION = "duration"
    SELECT = "select"
    MULTISELECT = "multiselect"
