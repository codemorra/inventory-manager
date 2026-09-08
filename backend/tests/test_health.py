from fastapi.testclient import TestClient

from app.main import create_app


def test_health_check() -> None:
    """Verify that the health endpoint returns a successful status."""
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
