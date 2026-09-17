from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.field_types import InventoryFieldType
from app.models.inventory_field import InventoryField
from app.models.inventory_field_option import InventoryFieldOption
from app.schemas.inventory_field import (
    InventoryFieldOptionCreate,
    InventoryFieldOptionUpdate,
)
from app.services.inventories import utc_now
from app.services.inventory_fields import get_inventory_field


class InventoryFieldOptionNotFoundError(Exception):
    pass


class InventoryFieldOptionsNotSupportedError(Exception):
    pass


def _field_supports_options(inventory_field: InventoryField) -> bool:
    return inventory_field.field_type in {
        InventoryFieldType.SELECT,
        InventoryFieldType.MULTISELECT,
    }


def _require_options_supported(inventory_field: InventoryField) -> None:
    if not _field_supports_options(inventory_field):
        raise InventoryFieldOptionsNotSupportedError(inventory_field.id)


def create_inventory_field_option(
    session: Session,
    inventory_id: str,
    field_id: str,
    data: InventoryFieldOptionCreate,
) -> InventoryFieldOption:
    inventory_field = get_inventory_field(session, inventory_id, field_id)
    _require_options_supported(inventory_field)

    position_statement = (
        select(func.count())
        .select_from(InventoryFieldOption)
        .where(
            InventoryFieldOption.field_id == field_id,
            InventoryFieldOption.deleted_at.is_(None),
        )
    )
    position = session.scalar(position_statement) or 0

    inventory_field_option = InventoryFieldOption(
        field_id=field_id,
        name=data.name,
        position=position,
    )

    session.add(inventory_field_option)
    session.commit()
    session.refresh(inventory_field_option)

    return inventory_field_option


def list_inventory_field_options(
    session: Session,
    inventory_id: str,
    field_id: str,
) -> list[InventoryFieldOption]:
    get_inventory_field(session, inventory_id, field_id)

    statement = (
        select(InventoryFieldOption)
        .where(
            InventoryFieldOption.field_id == field_id,
            InventoryFieldOption.deleted_at.is_(None),
        )
        .order_by(InventoryFieldOption.position)
    )

    return list(session.scalars(statement))


def get_inventory_field_option(
    session: Session,
    inventory_id: str,
    field_id: str,
    option_id: str,
) -> InventoryFieldOption:
    inventory_field = get_inventory_field(session, inventory_id, field_id)
    _require_options_supported(inventory_field)

    statement = select(InventoryFieldOption).where(
        InventoryFieldOption.id == option_id,
        InventoryFieldOption.field_id == field_id,
        InventoryFieldOption.deleted_at.is_(None),
    )
    inventory_field_option = session.scalar(statement)

    if inventory_field_option is None:
        raise InventoryFieldOptionNotFoundError(option_id)

    return inventory_field_option


def update_inventory_field_option(
    session: Session,
    inventory_id: str,
    field_id: str,
    option_id: str,
    data: InventoryFieldOptionUpdate,
) -> InventoryFieldOption:
    inventory_field_option = get_inventory_field_option(
        session,
        inventory_id,
        field_id,
        option_id,
    )

    if data.name is not None:
        inventory_field_option.name = data.name

    session.commit()
    session.refresh(inventory_field_option)

    return inventory_field_option


def delete_inventory_field_option(
    session: Session,
    inventory_id: str,
    field_id: str,
    option_id: str,
) -> None:
    inventory_field_option = get_inventory_field_option(
        session,
        inventory_id,
        field_id,
        option_id,
    )

    inventory_field_option.name = ""
    inventory_field_option.deleted_at = utc_now()

    session.commit()
