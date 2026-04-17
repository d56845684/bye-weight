# auth_service 測試流程

## 整合測試（end-to-end，透過 nginx）

位置：`tests/integration.sh`
涵蓋：health / dev-login / me / RBAC 擋非 super_admin / logout 撤銷

### 前置條件

整個開發環境已起來：

```bash
docker compose -f docker-compose.dev.yml --profile full up -d
```

等到 `auth_service` log 顯示 `auth service listening on :8001` 即可。

### 執行

```bash
bash auth_service/tests/integration.sh
```

預期結果：所有 assertion 都 ✓，`PASS: 8 / FAIL: 0`。

### 涵蓋的情境

| # | 測試 | 預期 |
|---|------|------|
| 1 | `GET /auth/health` | 200 |
| 2 | `POST /auth/dev-login` 預設 body | role=super_admin |
| 3 | `GET /auth/me` 帶 cookie | role=super_admin |
| 4 | `GET /api/patients` 無 cookie | 401 |
| 5 | `GET /auth/admin/users` 以 super_admin | 200 |
| 6a | `GET /auth/admin/users` 以 admin | 403（RBAC 擋）|
| 6b | `GET /admin/users` HTML 以 admin | 403（nginx auth_request 擋） |
| 7a | `POST /auth/password-login` 正確 | role=super_admin + set cookie |
| 7b | `POST /auth/password-login` 錯密碼 | 401 `invalid credentials` |
| 7c | `POST /auth/password-login` 不存在帳號 | 401 `invalid credentials` |
| 8a | `GET /auth/admin/roles` | 回列表，super_admin / patient 標記 locked=true |
| 8b | `POST /auth/admin/roles {name:"doctor_test"}` | 201 |
| 8c | 再次建立同名 | 409 |
| 8d | 建立不合法名稱（大寫、空格） | 400 |
| 8e | `PUT /auth/admin/roles/:id/permissions` | 200，讀回一致 |
| 8f | `PUT` 給 super_admin | 423 Locked（永遠持有全部權限）|
| 8g | `DELETE` super_admin / patient | 423 Locked |
| 8h | `DELETE` 還有 user 綁定的 role | 422 `role has users assigned` |
| 8i | `DELETE` 沒 user 的自建 role | 200 |
| 9 | `POST /auth/logout` + 再打 `/auth/me` | 401 `token revoked` |

### 角色管理相關端點

| 方法 | 路徑 | 說明 | permission |
|------|------|------|-----------|
| GET | `/auth/admin/roles` | 列出所有角色 + 使用者數 + 權限數 | `role:list` |
| POST | `/auth/admin/roles` | 建立（body `{name}`）| `role:create` |
| DELETE | `/auth/admin/roles/{id}` | 刪除 | `role:delete` |
| GET | `/auth/admin/permissions` | 列出所有 permissions | `permission:list` |
| GET | `/auth/admin/roles/{id}/permissions` | 查角色當前 permission_ids | `role:list` |
| PUT | `/auth/admin/roles/{id}/permissions` | 完整覆蓋（body `{permission_ids}`）| `role:update` |

### 系統角色保護規則

| 角色 | 刪除 | 改權限 |
|------|:---:|:----:|
| `super_admin` | ❌ 423 | ❌ 423（永遠有全部權限）|
| `patient` | ❌ 423 | ✅ 允許 |
| 其他（`admin`/`staff`/`nutritionist`/自建） | 若無 user 綁定才能刪 | ✅ 允許 |

### 後台預設測試帳號

| 欄位 | 值 |
|------|------|
| email | `admin@dev.local` |
| 密碼 | `admin123` |
| 角色 | `super_admin` |
| 設定在 | migration 0005（`crypt('admin123', gen_salt('bf', 10))`）|

**正式環境務必改密碼或刪除此 seed。**

### Redis 快取陷阱

每次跑 migration 新增 permission 後，**必須清 redis 快取**，否則 engine 會讀到舊的 permission routes：

```bash
docker compose -f docker-compose.dev.yml exec redis redis-cli FLUSHALL
docker compose -f docker-compose.dev.yml restart auth_service
```

### 失敗除錯

| 症狀 | 檢查 |
|------|------|
| dev-login 回 `user not found` | migration 3（seed dev-admin）是否跑過；`SELECT * FROM users WHERE line_uuid='dev-admin';` |
| admin 角色沒被擋（回 200） | engine 快取過期 → 跑上述 FLUSHALL + restart |
| `/auth/verify` 回 503 | Redis 連線異常（fail-closed）|
| verify 回 401 `token revoked` | Redis blacklist 還殘留；FLUSHALL |
