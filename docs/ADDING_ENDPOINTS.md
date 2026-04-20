# 新增服務 / 頁面 / endpoint 的對齊手冊

> 目的：新增任何對外可呼叫的 URL 時，確保 `auth_service` 認得 → `policy` 放行 → `tenant` 可訂閱。

## 三層對齊

```
Nginx location       ← 入口路由
  ↓
action_mappings      ← URL → (action, resource ARN) 的映射
  ↓
role_policies        ← 哪些 role 能執行哪些 action（靠 policy document 判定）
  ↓
tenant_services      ← 該 tenant 有沒有訂閱這個 service
```

漏掉任何一層，engine 的 `verify.go` 都會回 `403 Forbidden`。所以加任何東西之前，先從這張流程圖對照。

---

## 情境 A：在現有服務加一個 API endpoint（最常見）

例：`main_service` 新增 `GET /api/v1/reports/monthly`。

### 1. 後端實作

```python
# main_service/routers/reports.py
router = APIRouter(prefix="/reports", tags=["reports"])

@router.get("/monthly")
async def monthly_report(
    user: dict = Depends(current_user),
    db:   AsyncSession = Depends(get_db),
):
    ...
```

在 `main_service/main.py` 掛進去：
```python
app.include_router(reports.router, prefix=V1)  # V1 = "/v1"
```

### 2. Nginx

不需動。`/api/v1/` 已是 catch-all。

### 3. `action_mappings` 加一筆（auth_db migration）

建新檔 `auth_service/migrations/000006_reports.up.sql`：

```sql
BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'GET', '/reports/monthly', 'main:report:read',
       'main:tenant/${auth:tenant_id}/report/monthly'
FROM services s WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

COMMIT;
```

對應的 `.down.sql`：
```sql
DELETE FROM action_mappings
 WHERE action = 'main:report:read'
   AND service_id = (SELECT id FROM services WHERE name = 'main');
```

### 4. 評估 policy

先想「誰該看得到這個報表」：

| 想法 | 做法 |
|---|---|
| admin 與 staff 可看，patient 不可 | 把 `main:report:read` 加進 `clinic-admin` / `staff-clinic-ops` policy 的 `actions` list |
| 所有 role 都可看 | 每份 policy 都加 |
| super_admin 自動可看 | `super-admin-all` 的 `actions: ["*"]` 已涵蓋，**無需改動** |

改 policy document 的兩種做法：
- UI：`/admin/roles/{role_id}`（編輯 Policy）有 JSON 編輯視覺化（目前為唯讀顯示，需手動改 DB）
- SQL：`UPDATE policies SET document = jsonb_set(...) WHERE name = 'clinic-admin';`

### 5. 刷新 cache

engine 每 5 分鐘自動重載。要立刻生效：
```bash
curl -X POST http://localhost:8080/auth/v1/admin/invalidate -b cookie.txt
```
或後台 `/admin/tenants` 的 **「🔄 刷新權限快取」** 按鈕。

### 6. 驗證

```bash
curl -b cookie.txt http://localhost:8080/api/v1/reports/monthly
# 200 = 對齊完成
# 403 "no action mapping" = 步驟 3 沒做
# 403 "permission denied" = 步驟 4 沒做
# 403 "service ... not enabled for tenant" = 該 tenant 沒訂 main service（情境 B 才會遇到）
```

---

## 情境 B：整個新服務（例：`billing_service`）

### 1. 實作 + 容器

```yaml
# docker-compose.yml
billing_service:
  build: ./billing_service
  expose: ["8002"]
  env_file: ./billing_service/.env
```

### 2. Nginx 加 location

```nginx
# nginx/nginx.conf
location /api/v1/billing/ {
    auth_request        /auth/verify;

    auth_request_set    $user_id    $upstream_http_x_user_id;
    auth_request_set    $user_role  $upstream_http_x_user_role;
    auth_request_set    $tenant_id  $upstream_http_x_tenant_id;
    proxy_set_header    X-User-Id   $user_id;
    proxy_set_header    X-User-Role $user_role;
    proxy_set_header    X-Tenant-Id $tenant_id;

    rewrite             ^/api/v1/billing/(.*) /$1 break;
    proxy_pass          http://billing_service:8002;
    proxy_set_header    Host $host;
    proxy_set_header    X-Real-IP $remote_addr;
    proxy_set_header    X-Forwarded-Proto $scheme;
}
```

### 3. 一份完整 migration 註冊服務

```sql
BEGIN;

-- (a) 註冊 service（prefix 一定帶版本號）
INSERT INTO services (name, prefix) VALUES ('billing', '/api/v1/billing');

-- (b) 逐一註冊 endpoints
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',  '/invoices',      'billing:invoice:read',  'billing:tenant/${auth:tenant_id}/invoice/*'),
    ('POST', '/invoices',      'billing:invoice:write', 'billing:tenant/${auth:tenant_id}/invoice'),
    ('GET',  '/invoices/{id}', 'billing:invoice:read',  'billing:tenant/${auth:tenant_id}/invoice/${path.id}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'billing';

-- (c) 建一份對應的 policy
INSERT INTO policies (name, document) VALUES
    ('billing-tenant-access', '{
        "statements": [{
            "effect": "allow",
            "actions":   ["billing:invoice:*"],
            "resources": ["billing:tenant/${auth:tenant_id}/*"]
        }]
    }'::jsonb);

-- (d) 綁給 admin 角色
INSERT INTO role_policies (role_id, policy_id)
SELECT r.id, p.id FROM roles r, policies p
WHERE r.name = 'admin' AND p.name = 'billing-tenant-access';

-- (e) 決定哪些既有 tenant 訂閱
INSERT INTO tenant_services (tenant_id, service_id)
SELECT t.id, s.id FROM tenants t, services s
WHERE t.id != 0 AND t.active = true AND s.name = 'billing'
ON CONFLICT DO NOTHING;

-- (f) 更新 admin_tenants.go 的 defaultTenantServices（選擇性，讓新建 tenant 自動訂）

COMMIT;
```

### 4. 業務資料層（若有 DB）

- 自己的 DB：遵循 `main_service` 的 pattern，所有表加 `tenant_id` + RLS policy + `tenant_guard`。直接抄 `main_service/alembic/versions/0003_rls.py`。
- 共用 `app_db`：只要新表加 `tenant_id` + RLS policy 就夠。

### 5. Frontend API 呼叫

```tsx
// fetchAPI 已經把 /api/v1 加在前面了，直接寫子路徑即可
const invoices = await fetchAPI<Invoice[]>("/billing/invoices");
```

### 6. 後台訂閱 UI

`/admin/tenants/{id}` → Services tab，勾選 billing → 儲存。沒勾的 tenant 下次呼叫會被 engine 的 `IsServiceEnabled` 擋下。

---

## 情境 C：只加前端頁面（Next.js 路由，無 API）

例：後台加 `/admin/reports` 頁面。

1. 新檔 `frontend/src/app/admin/(dashboard)/reports/page.tsx`
2. **不用改 action_mappings** —— `/admin/*` 已是 `admin:view` 萬用萬配
3. `layout.tsx` nav 連結 `<Link href="/admin/reports">`
4. 若頁面要呼叫 API → follow 情境 A

---

## 情境 D：租戶自己的前端頁面（非後台）

例：給營養師加 `/nutritionist/dashboard` 頁面。

1. 新檔 `frontend/src/app/nutritionist/dashboard/page.tsx`
2. **大多數情況不需要 auth gate**（nutritionist 登入時已有 cookie，API 層會驗）
3. 若要頁面層級 role-gate：nginx 加 `location /nutritionist/` + `auth_request`，同時 action_mapping 註冊一筆 `GET /nutritionist/*`

---

## 設計原則速查表

| 問題 | 答案 |
|---|---|
| Resource ARN 格式 | `{service}:tenant/${auth:tenant_id}/{type}/{id}` —— 永遠帶 tenant 前綴 |
| Action 格式 | `{service}:{resource}:{verb}`，例：`main:food_log:read` |
| 誰可以跨 tenant | 只有 super_admin（`*:*` wildcard），而且資料層的 RLS 仍會擋下（需 `rls_bypass()`）|
| policy `${auth:*}` 替換變數 | `${auth:user_id}`、`${auth:tenant_id}`、`${auth:role}`；path 變數用 `${path.{name}}` |
| `super-admin-all` 要不要改 | 通常不用，它是 `*:*` |
| engine cache 多久刷新 | 5 分鐘自動 / 改完 DB 後手動呼叫 `POST /auth/v1/admin/invalidate` |
| Deprecation 舊版 URL | 新版 `/api/v2/...` 加進 action_mappings 共存；v1 繼續服務，舊 policy 不動 |

---

## 常見踩雷

1. **忘了加 action_mapping** → `403 no action mapping`。症狀：連 super_admin 都被擋。
2. **resource_template 漏了 `${auth:tenant_id}` 前綴** → super_admin 以外所有角色撞上 policy 的 tenant-scoped resource 比對失敗。
3. **新 tenant 沒訂閱 service** → 新 endpoint 上線後，既有 tenant 不受影響，但**新建的 tenant** 若你忘了更新 `defaultTenantServices` 會抱怨沒權限。
4. **cache 沒刷** → DB 改了但 5 分鐘內看不到效果，以為自己寫錯。用 `/auth/v1/admin/invalidate` 立刻生效。
5. **main_service 忘了帶 `tenant_id` 過濾** → tenant_guard 會 raise，但不會自動修。看錯誤訊息補上 `WHERE Model.tenant_id == user["tenant_id"]`。

---

## 檢查清單（每次加 endpoint 都過一遍）

- [ ] 後端實作（router + handler）
- [ ] Nginx：新服務才需加 location；既有 /api/v1 自動涵蓋
- [ ] `action_mappings` migration：新增 action + resource template
- [ ] `policies`：確認現有 policy 是否夠用，不夠就改 JSONB document 或新建
- [ ] `tenant_services`：新服務才需決定誰訂
- [ ] `POST /auth/v1/admin/invalidate` 刷 engine cache
- [ ] curl / 後台實測一遍
- [ ] 若是 tenant-scoped 業務資料：對應 DB 加 `tenant_id` + RLS policy + `tenant_guard` 通過

---

## 參考

- 架構規格：[`architecture.md`](./architecture.md)
- 變更紀錄：[`CHANGELOG.md`](./CHANGELOG.md)
- 範例 migration：
  - `auth_service/migrations/000002_iam.up.sql` — main/auth service 註冊範本
  - `auth_service/migrations/000004_admin_service_subscriptions.up.sql` — admin service + 訂閱模型
- 範例 RLS：`main_service/alembic/versions/0003_rls.py`
