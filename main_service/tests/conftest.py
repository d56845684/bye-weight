import pytest
from httpx import ASGITransport, AsyncClient

from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def auth_headers():
    """模擬 Nginx 注入的 auth headers"""
    return {
        "X-User-Id": "1",
        "X-User-Role": "patient",
        "X-Clinic-Id": "clinic-001",
        "X-Patient-Id": "1",
    }


@pytest.fixture
def staff_headers():
    return {
        "X-User-Id": "10",
        "X-User-Role": "staff",
        "X-Clinic-Id": "clinic-001",
        "X-Patient-Id": "",
    }
