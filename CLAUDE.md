# bye-weight 專案指引

> 專案：LINE 醫療病患追蹤平台 MVP

## 架構文件

完整的系統架構技術規格（基礎設施、資料 schema、Auth 服務、部署流程等）請參閱：

- [`docs/architecture.md`](./docs/architecture.md) — 系統架構技術規格 v1.3

---

## 三個服務開發過程重點

> 實作位置：`bye-weight/`（`auth_service/`、`main_service/`、`frontend/`）

### auth_service（Go + chi，IAM-style）

- **模型** 已改為 AWS IAM 風格：policy documents（JSONB）+ role_policies + services / action_mappings；多租戶 **Hard isolation**（`users.tenant_id`，`0` 保留給 system tenant / super_admin）。
- **進入點** `main.go` 註冊 chi router，啟動時自動跑 migration，engine 做 5 分鐘 policy + action_mapping 快取刷新。
- **授權引擎** `engine/engine.go`：`ResolveAction(method, uri)` 透過 chi-style URL pattern 比對 `action_mappings` 拿到 `(action, resource_template)`；`Check(sub, action, resource)` 用 glob + `${auth:*}` 變數替換評估 policy documents，**explicit deny > allow > implicit deny**。
- **JWT claims** `{ user_id, role, tenant_id, jti, exp }`——所有領域欄位（patient_id / clinic_id）都不在 JWT 裡；下游服務透過 `X-User-Id` 自己查身份映射表。
- **Verify 流程** `handler/verify.go`：cookie → JWT → blacklist → ResolveAction → SubstituteResource → Check → 注入 `X-User-Id / X-User-Role / X-Tenant-Id`。
- **Schema migrations**
  - `000001-000007` 舊 RBAC/PBAC + password_auth + display_name
  - **`000008_iam_policies`** 砍掉 `permissions / role_permissions / policy_conditions / permission_policies`；新增 `tenants`、`services`、`action_mappings`、`policies(document JSONB)`、`role_policies`；seed 5 份 policy（`patient-self-access` / `staff-clinic-ops` / `nutritionist-ops` / `clinic-admin` / `super-admin-all`）
- **Admin API** `/auth/admin/users`、`/auth/admin/roles`、`/auth/admin/roles/{id}/policies`、`/auth/admin/policies`、`/auth/admin/tenants`。
- **主要依賴** chi v5、golang-jwt v5、pgx v5、go-redis v9；multi-stage Dockerfile，最終 image ~15–20 MB。

### main_service（Python FastAPI）

- **入口** `main.py` 掛載 8 個 router：health / patients / inbody / food_logs / visits / notifications / line_webhook / upload。
- **非同步資料層** `database.py` 用 SQLAlchemy 2.0 + asyncpg（pool_size=10）。
- **Alembic migrations**：`0001_init_schema` 建 9 張業務表；`0002_tenant_isolation` 給所有業務表加 `tenant_id NOT NULL DEFAULT 0`，`patients` 加 `auth_user_id UNIQUE`（身份映射 auth_db.users.id）。
- **認證解耦** `deps.py` 只讀 `X-User-Id / X-User-Role / X-Tenant-Id`；新增 `current_patient(user, db)` dependency 靠 `auth_user_id + tenant_id` 解析出當前 patient profile。所有授權判斷已經在 auth_service 做完。
- **多租戶 hard isolation** 每個 query 都多一層 `tenant_id = user["tenant_id"]` 的 WHERE 條件作為 defense-in-depth（即便有 URL 偽造，資料層也擋得住）。
- **Models** patient（含 auth_user_id / tenant_id）/ line_binding / employee / visit / medication / inbody / inbody_pending / food_log（JSONB）/ notification_rule / notification_log；全部帶 `tenant_id`。
- **已實作路由** food_logs（日期範圍 + 寫入時自動 `cache:food:*` invalidate）、inbody（上傳 + OCR pending 比對，`match_patient` 限同 tenant）、patients（GET + `/bind` 同時寫 auth_user_id）、visits（CRUD）、notifications、upload（GCS presigned URL，blob path 帶 `t{tenant}/p{patient}` 前綴）。
- **外部整合** `services/ocr.py`（Gemini 2.5 Flash 影像辨識骨架）、`services/matching.py`（姓名 + 生日雙欄位 patient 比對，限同 tenant，ambiguous 寫入 inbody_pending）、`services/notification.py`（LINE Push 骨架）。
- **待補** LINE webhook 事件分派、AI 飲食建議、notification 排程觸發邏輯仍為 stub。

### frontend（Next.js 14 App Router，約 60%）

- **App Router 分域** `src/app/` 依角色切四塊：`patient/` / `staff/` / `nutritionist/` / `admin/`，另有 `liff/` 處理 LINE LIFF 登入導流。
- **API 層** `lib/api.ts` 封裝 `fetchAPI`，自動帶 cookie、401 時呼叫 `/auth/refresh` 重試，仍失敗再導回 LIFF 重登。
- **Auth 橋接** `lib/auth.ts` 初始化 LIFF → `liff.getAccessToken()` → POST `/auth/line-token` 換 HttpOnly cookie，前端完全讀不到 JWT。
- **已拉頁面** `/patient/inbody`（Recharts 趨勢）、`/patient/food-logs`（營養素 grid）、`/patient/visits`、`/patient/notifications`、`/staff/inbody`（上傳）、`/nutritionist/push`、`/admin/patients`。
- **技術棧** Next.js 14.2（standalone output 便於 Docker）、React 18.3、TypeScript 5.4、Tailwind 3.4、LINE LIFF 2.24、Recharts 2.12。
- **待補** 表單互動、圖片上傳 presigned URL 串接、推播排程 UI 多為骨架。

### 服務整合要點

- **Nginx** 以 `auth_request = /auth/verify` 統一攔截 `/api/*`；`/api/line/webhook` 例外（改用 LINE signature 驗證）。通過後只轉發 generic identity header：`X-User-Id / X-User-Role / X-Tenant-Id`。
- **IAM-style 授權** action / resource 以字串表達，支援 `${auth:user_id}`、`${auth:tenant_id}`、`${path.*}` 變數替換；新增服務 = 在 auth_db seed 一組 `action_mappings` + 視情況寫新 policy。
- **雙資料庫** `auth_db`（身份 + 授權）與 `app_db`（業務）共用同一 Cloud SQL 實例但不跨庫 FK；`main_service.patients.auth_user_id` 是應用層身份映射。
- **多租戶** Hard isolation：`users.tenant_id` + 所有業務表 `tenant_id`，system tenant=0 保留給 super_admin。Policy 的 resource pattern 透過 `${auth:tenant_id}` 自動限縮。
- **Docker Compose** `docker-compose.yml` 走 Cloud SQL Proxy；`docker-compose.dev.yml` 預設只起 postgres + redis，加 `--profile full` 才全容器啟動三個服務 + nginx。
- **快取命名** auth 用 `auth:blacklist:*`、`auth:engine:cache`（policy+mapping 快取）；main 用 `cache:{resource}:*`，由寫入端主動 invalidate。

---

## 資料庫稽核欄位規範

### 必備欄位

所有**會被 UPDATE / DELETE 的實體表**（auth_db 與 app_db 皆適用）一律具備：

| 欄位 | 型別 | 誰填 |
|---|---|---|
| `created_at` | `TIMESTAMP` | DB 預設 `NOW()` 或 trigger |
| `created_by` | `INT`（對應 `auth_db.users.id`，無 FK） | Trigger 自動填（從 session 變數） |
| `updated_at` | `TIMESTAMP` | Trigger 自動填 `NOW()` |
| `updated_by` | `INT` | Trigger 自動填（從 session 變數） |
| `deleted_at` | `TIMESTAMP` | **應用層**明確 UPDATE 才填（soft delete）|
| `deleted_by` | `INT` | 同上 |

### 不加稽核的表

- **junction 表**（`role_policies` / `tenant_services` / `tenant_roles` 等）：只有 INSERT / DELETE，沒有 UPDATE 語義。要稽核靠父 entity 記錄。
- **append-only log 表**（`login_logs` / `notification_logs`）：本身就是事件流，加稽核是冗餘。

### Trigger 自動化

兩個 DB 都有 `audit_autofill()` 函式 + 每張表一個 `BEFORE INSERT OR UPDATE` trigger：

```sql
CREATE OR REPLACE FUNCTION audit_autofill() RETURNS TRIGGER AS $$
DECLARE
    uid INT;
BEGIN
    BEGIN
        uid := NULLIF(current_setting('app.current_user', true), '')::INT;
    EXCEPTION WHEN others THEN uid := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by IS NULL THEN NEW.created_by := uid; END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.updated_at := NOW();
        NEW.updated_by := uid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 應用層必做：SET LOCAL app.current_user

每個 request handler 在 transaction 裡一定要 `SET LOCAL app.current_user = <user_id>`，trigger 才讀得到。

**main_service（FastAPI + SQLAlchemy）**
`database.py` 的 `after_begin` event listener 自動從 `X-User-Id` header 讀並 SET LOCAL：

```python
@event.listens_for(Session, "after_begin")
def _apply_session_context(session, transaction, connection):
    connection.execute(text("SET LOCAL ROLE app_user"))
    if tid := _tenant_cv.get():
        connection.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": str(tid)})
    if uid := _user_cv.get():
        connection.execute(text("SELECT set_config('app.current_user', :u, true)"), {"u": str(uid)})
```

`get_db` dependency 讀 `X-User-Id` + `X-Tenant-Id` 寫進 contextvar。

**auth_service（Go）**
用 `handler/audit.go` 的 helper：

```go
// 單一 statement 用 withAudit
err := withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
    _, err := tx.Exec(r.Context(),
        `UPDATE users SET display_name = $1 WHERE id = $2`, name, id)
    return err
})

// 多步驟 tx 用 applyAuditContext
tx, _ := h.engine.DB().Begin(ctx)
defer tx.Rollback(ctx)
applyAuditContext(ctx, tx, r)   // 這行之後的 Exec 都會被 trigger 認到
// ... 多段 INSERT / UPDATE ...
tx.Commit(ctx)
```

Nginx `/auth/v1/admin/` location 會把 `X-User-Id` proxy 給 auth_service（從 `/auth/verify` 的 response header 拿）。非 admin 路由（例如登入本身）沒 X-User-Id → `updated_by` 為 NULL，可接受。

### Soft delete 慣例

**不**把現有 `DELETE` 語句改掉（太侵入性）。想對某張表支援 soft delete 時：

1. 把 `DELETE FROM x WHERE id = ?` 改成
   ```sql
   UPDATE x SET deleted_at = NOW(), deleted_by = $current_user WHERE id = ? AND deleted_at IS NULL
   ```
2. 所有 SELECT 加 `WHERE deleted_at IS NULL`（建議用 PostgreSQL VIEW 或 RLS policy 統一）
3. unique constraint 要考慮 deleted_at（例如 `UNIQUE (name, deleted_at)`），避免刪完不能重用名稱

### 新增服務 / 新表的 onboarding checklist

1. 新表 `CREATE TABLE x (... created_at TIMESTAMP DEFAULT NOW(), ...)` — 只需 `created_at`，`created_by / updated_* / deleted_*` 由 migration 後面統一 ALTER
2. migration 最後：
   ```sql
   ALTER TABLE x
       ADD COLUMN IF NOT EXISTS created_by INT,
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
       ADD COLUMN IF NOT EXISTS updated_by INT,
       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
       ADD COLUMN IF NOT EXISTS deleted_by INT;
   CREATE TRIGGER trg_x_audit BEFORE INSERT OR UPDATE ON x
       FOR EACH ROW EXECUTE FUNCTION audit_autofill();
   ```
3. 服務程式碼確保每個 request 都 SET LOCAL app.current_user（main_service 已在 `get_db` 自動；auth_service 用 `withAudit` / `applyAuditContext`；新服務抄 main_service pattern）
4. junction / log 表不套用

### 參考

- `auth_service/migrations/000007_audit_columns.up.sql`
- `main_service/alembic/versions/0004_audit_columns.py`
- `auth_service/handler/audit.go`
- `main_service/database.py`
