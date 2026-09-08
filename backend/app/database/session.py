import sqlite3
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.paths import ensure_app_directories

path = ensure_app_directories()

engine = create_engine(
    f"sqlite+pysqlite:///{path.database_path}",
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    expire_on_commit=False,
)


@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(
    database_connection: sqlite3.Connection,
    _: object,
) -> None:
    cursor = database_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
