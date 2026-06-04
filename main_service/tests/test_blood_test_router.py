"""routers/blood_test 的 mock-based 測試（不碰 DB）。

驗角色 gating：
  - /sync 與 /records 只給 admin 類角色；patient → 403
  - admin 觸發 /sync → 202 + 背景任務被排程（_run_sync 換成 spy，不碰 DB）
"""
from unittest.mock import MagicMock

import pytest


def _headers(user_id, role, tenant_id=1):
    return {"X-User-Id": str(user_id), "X-User-Role": role, "X-Tenant-Id": str(tenant_id)}


@pytest.fixture
def sync_spy(monkeypatch):
    spy = MagicMock()
    monkeypatch.setattr("routers.blood_test._run_sync", spy)
    return spy


@pytest.mark.asyncio
async def test_sync_requires_admin_role(client, sync_spy):
    resp = await client.post("/blood-test-reports/sync", headers=_headers(5, "patient"))
    assert resp.status_code == 403
    sync_spy.assert_not_called()


@pytest.mark.asyncio
async def test_sync_admin_accepted(client, sync_spy):
    resp = await client.post("/blood-test-reports/sync", headers=_headers(10, "staff"))
    assert resp.status_code == 202
    assert resp.json()["status"] == "accepted"
    sync_spy.assert_called_once()
    # args: (tenant_id, user_id, patient_id)
    assert sync_spy.call_args.args == (1, 10, None)


@pytest.mark.asyncio
async def test_sync_admin_with_patient_id(client, sync_spy):
    resp = await client.post(
        "/blood-test-reports/sync?patient_id=42", headers=_headers(10, "nutritionist")
    )
    assert resp.status_code == 202
    assert resp.json()["patient_id"] == 42
    assert sync_spy.call_args.args == (1, 10, 42)


@pytest.mark.asyncio
async def test_records_requires_admin_role(client, sync_spy):
    resp = await client.get("/blood-test-reports/records", headers=_headers(5, "patient"))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_sync_missing_headers_422(client, sync_spy):
    resp = await client.post("/blood-test-reports/sync")
    assert resp.status_code == 422
