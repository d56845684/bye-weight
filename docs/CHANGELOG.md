# Changelog

本檔記錄 bye-weight 平台的版本變更。遵循 [Semantic Versioning](https://semver.org/)。

## 版本定義

- **平台版本**：repo 層級，代表整個單體架構（auth_service + main_service + frontend + Nginx）的一個 stable 快照
- **對外 API 版本**：URL path 的 `/v1` / `/v2` 等前綴，獨立演進
- 目前：**平台 v1.0.0**，對外 API 為 **v1**

---

## v1.0.0 — 2026-04-18

首個 stable 里程碑。從 MVP 搭建（v0.x）躍升到 production-readiness 基礎：多租戶隔離、IAM 授權、API 版本化、管理後台。

### API 版本化（Breaking Change）

所有對外 API 加上 `/v1/` 前綴：

| 舊 | 新 |
|---|---|
| `/api/*` | `/api/v1/*` |
| `/auth/*` | `/auth/v1/*` |
| `/auth/admin/*` | `/auth/v1/admin/*` |

- 實作方式：**Nginx 層剝掉 `/v1/`** 再 proxy 給後端，後端程式碼無感
- `services.prefix` 帶版本（`main` → `/api/v1`、`auth` → `/auth/v1`），`action_mappings` 用完整 URI 比對 client 原始路徑
- Refresh token cookie `Path` 從 `/auth/refresh` 更新為 `/auth/v1/refresh`
- 將來加 v2：只需新增 services row + 新 location 區塊，v1/v2 可在同一 binary 共存
- 舊 URL 直接回 404（非 backward compatible；內部 dog-food 階段可接受）

### Auth：IAM-style 重構（Breaking Change）

拋棄 RBAC + PBAC 的 normalized 三張表設計，全面改成 **AWS IAM-style policy documents（JSONB）**。

**新 schema（auth_db）**

```
identity:    tenants, users, roles, login_logs
IAM core:    services, action_mappings, policies(document JSONB), role_policies
訂閱層:      tenant_services, tenant_roles
```

**核心抽象**

- `action`：命名空間字串 `{service}:{resource}:{verb}`，例：`main:food_log:read`、`admin:tenant:write`
- `resource`：ARN-style 字串，例：`main:tenant/${auth:tenant_id}/user/${auth:user_id}/inbody`
- `policy document`：一份 JSONB 內含多條 statement，每條有 `effect` / `actions` / `resources` / `conditions`
- **Explicit deny > allow > implicit deny**（跟 AWS IAM 一致）

**新 engine 流程（`handler/verify.go`）**

```
JWT → subject {user_id, role, tenant_id}
  ↓
engine.ResolveAction(method, uri) → (action, resource_template, path_attrs, service_name)
  ↓
engine.IsServiceEnabled(tenant_id, service_name)  ← 沒訂 service 直接 403
  ↓
SubstituteResource(template, subject, path_attrs) → concrete ARN
  ↓
engine.Check(subject, action, resource) ← 評估 role 對應的 policy documents
  ↓
注入 X-User-Id / X-User-Role / X-Tenant-Id header 給下游
```

**Seed policies**（由 migration 000002 建立）

| Policy | 綁定角色 | 範圍 |
|---|---|---|
| `patient-self-access` | patient | 自己 tenant 下自己 user_id 的 food_log / inbody / visit / notification |
| `staff-clinic-ops` | staff | 自己 tenant 內 inbody:*、food_log:read、visit:*、patient:read |
| `nutritionist-ops` | nutritionist | 自己 tenant 內 push + 營養師常用 CRUD |
| `clinic-admin` | admin | 自己 tenant 內全部業務資源 |
| `super-admin-all` | super_admin | `*:*` 全域 |

**JWT Claims 精簡**

```json
{ "user_id": 42, "role": "patient", "tenant_id": 3, "jti": "...", "exp": ... }
```

拿掉：`clinic_id`、`patient_id`。領域欄位一律由下游服務從 `X-User-Id` + `X-Tenant-Id` 自行解析。

### 多租戶：Hard isolation

**三層防線**

| 層級 | 誰擋 | 擋什麼 |
|---|---|---|
| 1. IAM resource ARN | auth_service | policy resource pattern 用 `${auth:tenant_id}` 自動限縮，跨 tenant 資源 ARN 根本進不了允許清單 |
| 2. `tenant_guard` Python event listener | main_service | 攔截 ORM SELECT/UPDATE/DELETE，tenant-scoped 表缺 `tenant_id` WHERE 條件就立刻 raise，dev/CI 早抓漏寫 |
| 3. PostgreSQL Row-Level Security | DB | 終極防線：`SET LOCAL ROLE app_user` + `SET LOCAL app.current_tenant` 後，policy `USING (tenant_id = current_setting('app.current_tenant')::int)` 自動過濾 |

**schema 配套**

- `auth_db.users.tenant_id NOT NULL DEFAULT 0`（`id=0` 是 system tenant，super_admin 專用）
- `app_db` 的 10 張業務表全部加 `tenant_id`：patients / line_bindings / employees / visits / medications / inbody_records / inbody_pending / food_logs / notification_rules / notification_logs
- `app_db.patients.auth_user_id UNIQUE`：對應 `auth_db.users.id`，是唯一跨 DB 身份映射點

**RLS 實作**（`main_service/alembic/versions/0003_rls.py`）

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON patients
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
        OR current_setting('app.bypass_rls', true) = 'true'
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
        OR current_setting('app.bypass_rls', true) = 'true'
    );
```

- `app_user` 非 superuser role：runtime connect 用 postgres superuser，但每個 transaction 開頭 `SET LOCAL ROLE app_user`（SQLAlchemy `after_begin` event listener）讓 RLS 生效
- `rls_bypass()` context manager：Cloud Scheduler 等跨租戶排程用；同時也 bypass `tenant_guard`
- 非啟用 RLS context 時（例如沒設 `app.current_tenant`）預設 fail-closed —— 查不到任何 row，寫不進任何 row

### 管理後台：admin 獨立服務

把 admin 從 `auth` service 的一部分提升為獨立 service（在 `services` 表自成一列）。

**action 命名空間統一改 `admin:*`**

```
admin:view                 後台 SPA 頁面進入（/admin/*）
admin:tenant:read/write    tenant CRUD + 訂閱管理
admin:user:read/write      user CRUD
admin:role:read/write      role CRUD + policy 綁定
admin:policy:read          policy 列表
admin:service:read         service 列表
```

**新增 tenant 訂閱模型**

```
tenant_services(tenant_id, service_id)   ← 這 tenant 能用哪些下游 service
tenant_roles(tenant_id, role_id)          ← 這 tenant 能發哪些角色給 user
```

- 新建 tenant 預設訂 `auth` / `main` / `frontend` + `patient` / `staff` / `nutritionist` / `admin`
- **`admin` service 預設不訂**，只有 system tenant 訂 → 非 super_admin 碰不到後台
- `super_admin` role 預設只留給 system tenant

**工作流程**

1. super_admin 以 `admin@dev.local / admin123`（dev seed）登入 `/admin/login`
2. `/admin/tenants` 建立新 tenant → 後端自動 seed 預設訂閱
3. 進 `/admin/tenants/[id]` 三個 tabs（基本資訊 / 服務 / 角色）調整訂閱
4. `/admin/users` 建立 user：選 tenant 後 role 下拉自動 filter 該 tenant 訂閱的角色
5. `/admin/roles` 管理 policy 綁定

### Schema Migrations 清理

**auth_db**（從 8 支 → 3 支）

```
000001_init.up.sql         identity 層：tenants(id=0 system)、users、roles、login_logs、pgcrypto
000002_iam.up.sql          IAM 層：services、action_mappings、policies(JSONB)、role_policies + seed
000003_dev_admin.up.sql    dev super_admin 帳號（admin@dev.local / admin123）
000004_admin_service_subscriptions.up.sql
                           tenant_services + tenant_roles + 把 admin 拔到獨立 service
```

**app_db**（累加 0002、0003）

```
0001_init_schema.py                10 張業務表
0002_tenant_isolation.py           tenant_id 加到所有業務表、patients 加 auth_user_id UNIQUE
0003_rls.py                        RLS + tenant_isolation policy + app_user role + GRANT
```

### 其他改動

- **Access token TTL** 900s → 3600s（1 小時）
- **Dashboard layout silent refresh**：進頁面 + 每 10 分鐘 + 切回分頁都 POST `/auth/v1/refresh`，避免閒置後頁面 navigation 被 Nginx auth_request 401 退回登入頁
- **管理介面命名**：移除「金鑽減重」品牌字樣（admin 後台）；前端 `/admin` 預設落地頁改 `/admin/tenants`
- **刪除 `/admin/patients` 頁面**：super_admin 在新架構下看不到 tenant 業務資料，頁面變成永遠空的

### 新增 / 移除檔案

**新增**

```
auth_service/handler/admin_services.go
auth_service/handler/admin_tenants.go                （擴充）
auth_service/migrations/000001_init.*.sql            （重寫）
auth_service/migrations/000002_iam.*.sql
auth_service/migrations/000003_dev_admin.*.sql
auth_service/migrations/000004_admin_service_subscriptions.*.sql
main_service/alembic/versions/0002_tenant_isolation.py
main_service/alembic/versions/0003_rls.py
main_service/utils/tenant_guard.py
main_service/tests/tenant_isolation.sh
frontend/src/app/admin/(dashboard)/tenants/page.tsx
frontend/src/app/admin/(dashboard)/tenants/[id]/page.tsx
docs/CHANGELOG.md                                     （本檔）
```

**刪除**

```
auth_service/migrations/000001_init_schema.*.sql      （舊版 RBAC schema，被新 000001 取代）
auth_service/migrations/000002_seed_rbac.*.sql        （舊 RBAC seed）
auth_service/migrations/000003_seed_dev_admin.*.sql
auth_service/migrations/000004_super_admin.*.sql
auth_service/migrations/000005_password_auth.*.sql
auth_service/migrations/000006_role_management.*.sql
auth_service/migrations/000007_display_name.*.sql
frontend/src/app/admin/(dashboard)/patients/page.tsx
```

### 驗證

| 測試腳本 | 覆蓋 |
|---|---|
| `auth_service/tests/integration.sh` | login/logout/refresh + admin CRUD + RBAC/policy 擋權限 |
| `main_service/tests/integration.sh` | Nginx auth_request → main API 通過 |
| `main_service/tests/tenant_isolation.sh` | **11 個 assertion**：HTTP 跨 tenant 讀寫、RLS SELECT / INSERT / bypass |
| `frontend/tests/integration.sh` | frontend 路由權限檢查 |

### 升級注意（從 v0.x 升上來）

- **Schema 有 breaking change**：auth_db 必須 DROP + re-run migration；app_db 需跑 `alembic upgrade head`
- **Dockerfile 需重 build**：migration SQL 是 COPY 進 image 的
- **API client** 需改 URL 前綴加 `/v1`
- LINE Messaging Webhook URL 需改設定（`/api/line/webhook` → `/api/v1/line/webhook`）
- Cloud Scheduler target URL 需改（`/api/internal/notify/run` → `/api/v1/internal/notify/run`）

### 參考資料

- 架構規格：[`architecture.md`](./architecture.md)
- 專案指引：[`../CLAUDE.md`](../CLAUDE.md)
