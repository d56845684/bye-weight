# 本機 + LINE 整合測試流程（cloudflared）

從零開始到可以在手機 LINE 內完成綁定、登入、用 app。約 15 分鐘。

---

## 0. 需要先裝好

```bash
brew install cloudflared
# docker / docker compose 已有
```

LINE 帳號一個（個人即可）。

---

## 1. 起本機服務

```bash
cd bye-weight
docker compose -f docker-compose.dev.yml --profile full up -d
```

確認都起來：
```bash
curl -s http://localhost:8080/auth/health   # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/   # 200
```

---

## 2. 開 cloudflared tunnel

```bash
cloudflared tunnel --url http://localhost:8080
```

輸出會有一行：
```
https://random-words-1234.trycloudflare.com
```

**複製這個 URL**，後續稱為 `$TUNNEL`。這個視窗保持開著，關了 URL 就失效。

> 每次重開 URL 都會變——LINE console 的設定要跟著改。如果很煩可以改用 named tunnel（需要 cloudflared login + cloudflare 帳號）。

驗證 tunnel 通了：
```bash
curl -sI https://random-words-1234.trycloudflare.com/auth/health
# 應該看到 HTTP/2 200
```

---

## 3. LINE Developers Console 設定

到 https://developers.line.biz/console/ 登入。

### 3a. 建 Provider

隨意命名，例如「金鑽減重 Dev」。

### 3b. 建 Messaging API channel（推播 + webhook 用）

在 Provider 底下 `Create a new channel` → `Messaging API`：
- Channel name / description 隨意
- Category / Subcategory 隨意

建好後：
- **Basic settings** 頁 → `Channel secret` → 複製 → 記為 `LINE_CHANNEL_SECRET`
- **Messaging API** 頁：
  - `Channel access token (long-lived)` → 點 `Issue` → 複製 → 記為 `LINE_CHANNEL_ACCESS_TOKEN`
  - `Webhook URL` → 填 `$TUNNEL/api/line/webhook` → Save → 按 `Verify` 應回 Success
  - `Use webhook` → **Enabled**
  - `Auto-reply messages` → **Disabled**
  - `Greeting messages` → 看你要不要
- QR code 在同一頁底下，**用手機 LINE 掃 → 加為好友**

### 3c. 建 LINE Login channel（LIFF 用）

同 Provider 底下 → `Create a new channel` → **LINE Login**：
- App types：勾 `Web app`
- 其他隨意

建好後：
- **Basic settings** → scroll 到底 → 加 Callback URL：`$TUNNEL/liff`
- **LIFF** 頁 → `Add` 新增一個 LIFF app：
  - LIFF app name：隨意
  - Size：**Full**
  - Endpoint URL：`$TUNNEL/liff`
  - Scopes：勾 **profile** 和 **openid**
  - Bot link：**On (Aggressive)**（讓使用者開 LIFF 自動加 Messaging API 的 bot）
- 建完會有一組 LIFF ID，形如 `2001234567-aBcDeFg`。複製 → 記為 `LIFF_ID`

---

## 4. 填 env 檔

編輯三個 `.env.docker`（dev 環境用的）：

```bash
# auth_service/.env.docker — 加 / 改這幾行
LINE_CHANNEL_SECRET=<3b 拿到的>
LIFF_ID=<3c 拿到的>

# main_service/.env.docker
LINE_CHANNEL_SECRET=<3b 拿到的，同一個>
LINE_CHANNEL_ACCESS_TOKEN=<3b 拿到的>
LIFF_ID=<3c 拿到的>

# frontend/.env.docker
NEXT_PUBLIC_LIFF_ID=<3c 拿到的>
```

---

## 5. 重 build + 重啟

frontend 的 `NEXT_PUBLIC_*` 是 build 時 inline 進靜態檔，**必須重 build**：

```bash
docker compose -f docker-compose.dev.yml --profile full build frontend
docker compose -f docker-compose.dev.yml --profile full up -d
```

`auth_service` / `main_service` 只改 runtime env 所以不用 rebuild，但要重啟：

```bash
docker compose -f docker-compose.dev.yml restart auth_service main_service
```

---

## 6. 跑完整流程

### 6a. 管理員建好要綁定的使用者

在電腦瀏覽器打開：
```
$TUNNEL/admin/login
```

用 `admin@dev.local` / `admin123` 登入。

進 `/admin/users` → 點 **+ 新增 user（產綁定連結）**：
- 顯示名稱：你的名字
- 角色：`patient`（或 `staff` 等）
- 診所代碼：`C001`

建完 Modal 會跳 QR + 連結（形如 `https://liff.line.me/2001234567-xxx?token=...`）。

### 6b. 使用者（你自己）用 LINE 綁定

**手機 LINE 裡**：
1. 掃 Modal 上的 QR，或把連結傳到 LINE 自己聊天室點擊
2. LINE 會開 LIFF 畫面 → 首次會要求授權（允許讀 profile）
3. 看到「綁定中...」→ 自動轉到對應角色首頁（patient 會到 `/patient/food-logs`）

到這步 LINE UUID 已寫入 `users.line_uuid`，JWT cookie 也發了。

### 6c. 驗證

回電腦後台：`/admin/users` 重新整理 → 剛剛那筆 user 的狀態變 **已綁 LINE**。

後續使用者只要開 LIFF 連結（不帶 token）就會直接登入。

---

## 常見坑

| 症狀 | 原因 |
|------|------|
| LINE 沒回傳 access token / `liffId is necessary for liff.init()` | `NEXT_PUBLIC_LIFF_ID` 沒 inline 進 JS bundle。Dockerfile 會在 build 時 `cp .env.docker .env.production`，所以只要 `.env.docker` 填好後 **rebuild frontend**（不是只 restart）即可 |
| Webhook Verify 失敗 | tunnel 沒通、或 LINE_CHANNEL_SECRET 不一致 |
| 綁定時 401 invalid LINE token | LINE access token 過期（通常超過 12 小時）——重開 LIFF 頁即可 |
| 綁定時 410 token expired | Redis 過期（7 天），到後台重產 |
| 綁定時 409 | 這 LINE 已綁別人 / 這 user 已綁過 LINE。SQL 檢查 `SELECT line_uuid, display_name FROM users` |
| cloudflared URL 換了，整個流程掛 | 每次起 tunnel URL 都會變，LINE console 的 Webhook URL、LIFF Endpoint URL 要同步改 |
| 403 權限不足（進 /admin/*） | 你登的帳號不是 super_admin；到 DB 手動改 role，或用 admin@dev.local 登 |
| Redis cache 問題 | `docker compose -f docker-compose.dev.yml exec redis redis-cli FLUSHALL` |

---

## 關掉 tunnel 後

直接 Ctrl+C `cloudflared` 視窗。下次要用重開就好，但 URL 會變（記得回 LINE console 同步改）。

要省這個步驟，可建 named tunnel：

```bash
cloudflared tunnel login           # 用瀏覽器登 cloudflare
cloudflared tunnel create bye-weight-dev
# 在 DNS 設 CNAME 指向 tunnel
cloudflared tunnel route dns bye-weight-dev dev.yourdomain.com
# ~/.cloudflared/config.yml：
#   tunnel: <UUID>
#   credentials-file: /path/to/<UUID>.json
#   ingress:
#     - hostname: dev.yourdomain.com
#       service: http://localhost:8080
#     - service: http_status:404
cloudflared tunnel run bye-weight-dev
```

之後 `dev.yourdomain.com` 永遠固定，LINE console 只要設一次。
