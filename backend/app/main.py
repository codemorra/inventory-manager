from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.logging import configure_logging
from app.core.paths import ensure_app_dir_exists


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    paths = ensure_app_dir_exists()
    logger = configure_logging(paths)

    logger.info("Application started")

    yield

    logger.info("Application stopped")


def create_app() -> FastAPI:
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
