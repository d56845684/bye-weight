"""最小的 pytest — 驗 FastAPI app 能啟動、/health 回 200。
真正業務流程的測試走 integration.sh。
"""
import pytest


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_missing_auth_headers(client):
    """current_user dep 沒有 X-User-Id / X-User-Role / X-Tenant-Id 應回 422"""
    resp = await client.get("/meetings")
    # FastAPI dependency validation error = 422
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_missing_one_header(client):
    """只漏一個 header 也應該 422"""
    resp = await client.get("/meetings", headers={
        "X-User-Id": "1001",
        "X-User-Role": "kuji_user",
        # 缺 X-Tenant-Id
    })
    assert resp.status_code == 422
