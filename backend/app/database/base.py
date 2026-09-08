"""Provide the declarative base for database models."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Serve as the shared base class for SQLAlchemy models."""

    pass
