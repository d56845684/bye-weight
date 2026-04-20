import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app


# pytest-asyncio 0.21+ 要求 async fixture 用 @pytest_asyncio.fixture；
# 用 @pytest.fixture 會回 async_generator，test body 拿到的就不是 AsyncClient。
@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# 模擬 Nginx 注入的 auth headers（IAM 模型：只有 X-User-Id / X-User-Role / X-Tenant-Id；
# 領域欄位 patient_id / clinic_id 已不在 JWT 裡，由各服務自己查映射）
def _headers(user_id: int, role: str, tenant_id: int) -> dict:
    return {
        "X-User-Id": str(user_id),
        "X-User-Role": role,
        "X-Tenant-Id": str(tenant_id),
    }


@pytest_asyncio.fixture
def patient_headers():
    return _headers(user_id=1, role="patient", tenant_id=1)


@pytest_asyncio.fixture
def staff_headers():
    return _headers(user_id=10, role="staff", tenant_id=1)
