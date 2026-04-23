"""pytest fixtures — 抄 main_service pattern：用 httpx ASGITransport 直打 FastAPI app
（不依賴 nginx / auth_service），headers 模擬 nginx 注入的身份。

Unit 測試範圍：route → deps → schema，不碰實際 DB 業務表（health 這類 stateless endpoint）。
業務邏輯測試透過 integration.sh 走完整 stack。
"""
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _headers(user_id: int, role: str, tenant_id: int) -> dict:
    return {
        "X-User-Id": str(user_id),
        "X-User-Role": role,
        "X-Tenant-Id": str(tenant_id),
    }


@pytest_asyncio.fixture
def kuji_user_headers():
    """demo tenant 的 Emily Lin（用於模擬已過 auth_request 的 request）。"""
    return _headers(user_id=1001, role="kuji_user", tenant_id=1)
