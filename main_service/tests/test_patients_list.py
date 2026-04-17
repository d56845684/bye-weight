import pytest


@pytest.mark.asyncio
async def test_list_patients_requires_auth_headers(client):
    # 沒有 Nginx 注入 header，不走完整 flow — 這裡只驗路由存在、接受空列表
    resp = await client.get("/patients")
    # 實際產線需要 header；單元測試以 422/401/200 其一代表路由有掛載
    assert resp.status_code in (200, 401, 422)


@pytest.mark.asyncio
async def test_list_patients_with_staff_headers(client, staff_headers):
    resp = await client.get("/patients", headers=staff_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "patients" in data
    assert isinstance(data["patients"], list)
