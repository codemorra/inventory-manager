"""Create and configure the FastAPI application."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.logging import configure_logging
from app.core.paths import ensure_app_directories


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    """Initialize and shut down application resources.

    Args:
        _: FastAPI application instance managed by the lifespan hook.

    Yields:
        None: Control while the application is running.
    """
    paths = ensure_app_directories()
    logger = configure_logging(paths)

    logger.info("Application started")

    yield

    logger.info("Application stopped")


def create_app() -> FastAPI:
    """Build the configured FastAPI application.

    Returns:
        FastAPI: Configured application instance.
    """
    app = FastAPI(
        title="Inventory Manager API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)

    return app


app = create_app()
