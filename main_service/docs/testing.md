# main_service 測試流程

有兩種測試：

## A. Unit tests（pytest，容器內跑）

位置：`tests/test_*.py`
特點：ASGI transport 直接測 FastAPI app，不經網路 / nginx，快但不驗 auth 流程。

### 執行

```bash
# 容器內跑（推薦）
docker compose -f docker-compose.dev.yml exec main_service pytest -v

# 或在本機：cd main_service && pip install -r requirements.txt && pytest
```

### 已覆蓋

| 檔案 | 內容 |
|------|------|
| `test_health.py` | `GET /health` 回 `{status: ok}` |
| `test_patients_list.py` | `GET /patients` 路由存在、帶 staff header 回 JSON list |

### fixtures（`conftest.py`）

- `client`：`httpx.AsyncClient` + `ASGITransport`
- `auth_headers`：模擬 nginx 注入的 patient header（role=patient, patient_id=1）
- `staff_headers`：模擬 staff header

## B. Integration test（curl，透過 nginx）

位置：`tests/integration.sh`
特點：實際打 `localhost:8080`，會經過 auth_service + nginx + main_service 全鏈路。

### 前置條件

```bash
docker compose -f docker-compose.dev.yml --profile full up -d
```

等到 nginx container 起來（約 3–5 秒）。

### 執行

```bash
bash main_service/tests/integration.sh
```

### 涵蓋的情境

| # | 測試 | 預期 |
|---|------|------|
| 1 | `GET /api/patients` 無 cookie | 401 |
| 2 | `GET /api/patients` 帶 super_admin cookie | 200 |
| 3 | 回應含 `patients` 欄位（JSON） | yes |
| 4 | `GET /api/patients/999`（不存在） | 404 |

### 何時用哪個

- 改路由邏輯 / Pydantic schema / ORM → **pytest**（快）
- 改 auth 流程 / nginx 規則 / RBAC permission → **integration.sh**（端到端）
