from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Health check endpoint")
def get_health() -> dict[str, str]:
    return {"status": "ok"}
