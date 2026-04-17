# frontend 測試流程

目前只有整合測試（前端 SSR 頁面 + nginx auth_request 守門）。

## Integration test

位置：`tests/integration.sh`
特點：驗證 `/admin/*` 後台頁面只有 `super_admin` 角色能進入，其他角色被 nginx `auth_request` 擋下。

### 前置條件

```bash
docker compose -f docker-compose.dev.yml --profile full up -d
```

### 執行

```bash
bash frontend/tests/integration.sh
```

### 涵蓋的情境

| # | 身份 | 路徑 | 預期 |
|---|------|------|------|
| 1 | 未登入 | `/admin/users` | 401 |
| 2 | `patient` | `/admin/users` | 403 |
| 3 | `admin`（clinic admin） | `/admin/users` | 403 |
| 4 | `super_admin` | `/admin/users` | 200 |
| 5 | `super_admin` | `/admin/patients` | 200 |
| 6 | 未登入 | `/`（首頁） | 200（不受 guard） |
| 7 | 未登入 | `/admin/login` | 200（登入頁不擋） |
| 8 | `super_admin` | `/admin/roles` | 200 |
| 9 | `admin` | `/admin/roles` | 403 |

### 後台頁面清單

| 路徑 | 用途 | 最小權限 |
|------|------|---------|
| `/admin/login` | 密碼登入 | 不擋 |
| `/admin/users` | 使用者列表 + 改 role / 停用 / 新增（產綁定連結）| `admin:access` |
| `/admin/roles` | 角色列表 + 新增 / 刪除 | `admin:access` |
| `/admin/roles/[id]` | 編輯角色權限（resource 分組 checkbox） | `admin:access` |
| `/admin/patients` | 病患列表 | `admin:access` |
| `/liff?token=...` | LIFF 綁定頁（非後台，LINE 內開） | 不擋 |

### 先建後綁操作步驟

1. super_admin 登入 `/admin/login`
2. `/admin/users` → 點「+ 新增 user（產綁定連結）」
3. 填 `顯示名稱 / 角色 / 診所代碼` → 建立
4. Modal 顯示 QR + 連結（7 天有效）
5. 把連結傳給使用者，使用者在 LINE 內開 → 自動綁 LINE UUID → 轉到對應角色首頁
6. admin 回到列表可看到該 user 狀態變 `已綁 LINE`，之後可改 role / 停用等

詳見 `auth_service/docs/binding.md`

### 後台登入頁

瀏覽器可以直接打開 `http://localhost:8080/admin/login`，用下列預設帳號登入：

- Email：`admin@dev.local`
- 密碼：`admin123`
- 角色：`super_admin`

登入成功後自動導到 `/admin/users`。

### 驗證策略說明

nginx 對 `/admin/` location 掛 `auth_request /auth/verify`，auth_service 會：
1. 從 cookie 解 JWT；沒有 → 401
2. 查 Redis blacklist；被撤銷 → 401
3. 解析 URI `/admin/users` → 對應 `admin:access` permission
4. 查 RBAC；角色無此 permission → 403
5. 通過 → 注入 `X-User-Role` 等 header 給 frontend container

所以 frontend 不需要自己做 guard，但頁面內的 API 呼叫（`fetch("/auth/admin/users")`）也會經過同一層 auth_request。

### 尚未涵蓋 / TODO

- 頁面 UI 互動（改 role select、停用按鈕）需要 Playwright 等瀏覽器測試，目前還沒裝
- LIFF 登入流程（需要 LINE 測試 token）
- 各角色登入後的 `/patient/*` / `/staff/*` 頁面導向
