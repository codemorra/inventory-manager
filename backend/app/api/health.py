"""Expose application health endpoints."""

from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Health check endpoint")
def get_health() -> dict[str, str]:
    """Return the current application health status.

    Returns:
        dict[str, str]: Health status response.
    """
    return {"status": "ok"}
