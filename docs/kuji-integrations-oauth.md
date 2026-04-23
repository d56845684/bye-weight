# Kuji 外部整合 OAuth 2.0 串接調查

> 目的：讓使用者透過 OAuth 2.0 連接 Kuji 與第三方服務（Notion / Slack / Google Calendar / Microsoft Teams / Zoom / Google Meet），避免手動貼 API token。
>
> 本文件整理各家 provider 的認證模式、必要 scopes、webhook 機制、token 刷新方式、以及 Kuji 後端需要補齊的欄位與流程。

---

## 1. 共通 OAuth 2.0 流程

所有 6 家都支援標準 **Authorization Code** flow：

```
user → GET https://kuji.app/kuji/api/v1/integrations/{kind}/connect
       ↓ (302)
provider authorize page  ← 使用者授權
       ↓
provider redirect → GET https://kuji.app/kuji/api/v1/integrations/{kind}/callback?code=XXX&state=YYY
       ↓
kuji_backend:
  1. 驗 state 對應 session（防 CSRF）
  2. POST {provider_token_endpoint} 換 access_token + refresh_token
  3. 存進 integrations（加密）
  4. 302 回 /kuji/integrations（前端）
```

### 需要的 DB 欄位（擴充 `integrations` 表）

| 欄位 | 型別 | 用途 |
|---|---|---|
| `oauth_access_token` | `TEXT`（pgcrypto `pgp_sym_encrypt`） | 呼叫 provider API |
| `oauth_refresh_token` | `TEXT`（加密） | access_token 過期後刷新 |
| `oauth_token_type` | `VARCHAR(20)` | 通常是 `Bearer` |
| `oauth_expires_at` | `TIMESTAMP` | access_token 何時失效 |
| `oauth_scope` | `TEXT` | 實際授權的 scopes（以空白分隔） |
| `external_workspace_id` | `VARCHAR(200)` | provider 端的 workspace / account ID（查詢用） |
| `external_user_id` | `VARCHAR(200)` | 授權人的 provider user ID |

**安全性**：access_token / refresh_token 必須加密儲存。建議用 PostgreSQL `pgcrypto` 的 `pgp_sym_encrypt`，key 從 `KUJI_ENCRYPTION_KEY` 環境變數讀；或改用 GCP KMS 做 envelope encryption。

### 需要的額外表

```sql
-- 中間狀態：OAuth 授權啟動時寫一筆，callback 驗 state 用
CREATE TABLE integration_oauth_states (
    state         VARCHAR(64) PRIMARY KEY,
    tenant_id     INT NOT NULL,
    user_id       INT NOT NULL,         -- 啟動的 kuji user
    kind          VARCHAR(20) NOT NULL,
    pkce_verifier VARCHAR(128),         -- 有支援 PKCE 的 provider 用
    expires_at    TIMESTAMP NOT NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);
-- 10 分鐘後 state 失效；每天跑 job 清掉 expired
```

### 前端流程

1. 使用者在 `/kuji/integrations` 點某家 provider 的「連接」按鈕
2. 前端 redirect 到 `/kuji/api/v1/integrations/{kind}/connect`（backend endpoint）
3. backend：產 state、產 PKCE verifier（如適用）、寫 `integration_oauth_states`、307 redirect 到 provider authorize URL
4. 使用者在 provider 頁面授權
5. provider redirect 回 `/kuji/api/v1/integrations/{kind}/callback`
6. backend 換 token、寫 `integrations.oauth_*`、302 回 `/kuji/integrations?connected={kind}`
7. 前端看到 query param `connected=notion` 彈 toast + 刷新列表

### 設定用彈窗的角色

OAuth 後還有很多 provider 端的「目標選擇」要做 — 例如 Notion 哪個 database、Slack 哪個 channel、GCal 哪個行事曆。這些要在 OAuth 完成後：

1. OAuth callback 完成後前端打開設定彈窗
2. 彈窗從後端另拿「可選目標」—— 後端用 `oauth_access_token` 去 provider 列 DB / channel / calendar
3. 使用者選完後 PUT `/integrations/{kind}` 存到 `config JSONB`

所以之前規劃的 `integration_providers.fields` schema 依然需要，但 fields 不再是 `password` / `text` 類（token 類），而是 `select`（動態選項）、`checkbox`（偏好開關）、`text`（少數靜態欄位如 email）。

---

## 2. 各 provider 詳細

### 2.1 Notion

- **Docs**：<https://developers.notion.com/docs/authorization>
- **Auth model**：標準 OAuth 2.0（不強制 PKCE，但支援）
- **App 註冊**：<https://www.notion.so/my-integrations>
  - Type 選 **Public integration**（Internal 不走 OAuth）
  - 需填 redirect URI：`https://kuji.app/kuji/api/v1/integrations/notion/callback`
  - Notion OAuth 有 **per-workspace** 授權 — 每個 workspace 要單獨授權

| 步驟 | URL |
|---|---|
| Authorize | `https://api.notion.com/v1/oauth/authorize?owner=user&client_id={CLIENT_ID}&response_type=code&state={STATE}&redirect_uri={URI}` |
| Token | POST `https://api.notion.com/v1/oauth/token` (Basic auth: `base64(client_id:client_secret)`) |

**Scopes**：Notion 不用傳 scope 參數；授權後整個 workspace 的指定頁面（使用者在 authorize 頁面勾選的）都可以存取。

**Token 特性**：
- `access_token` **不過期**（沒 refresh_token）
- response 含 `workspace_name`、`workspace_id`、`owner`、`bot_id`

**Webhook / push 通知**：官方 Webhook 2024 才 GA，可監聽 page/database 更新。Kuji 初期可用輪詢。

**API 呼叫**：`POST https://api.notion.com/v1/pages`（建立 task as page）；要指定 `parent.database_id`（就是使用者在設定彈窗選的）。

**Kuji 設定彈窗需要的額外資料**（OAuth 完成後）：
- GET `/v1/search` → 列所有 database → 彈窗 select「任務寫入哪個 DB」
- GET `/v1/databases/{id}` → 讀 schema → 決定 task 要填哪些 property

---

### 2.2 Slack

- **Docs**：<https://api.slack.com/authentication/oauth-v2>
- **Auth model**：OAuth 2.0 V2（有舊版 V1，新 app 一律用 V2）
- **App 註冊**：<https://api.slack.com/apps> → Create New App → From scratch
  - Features → OAuth & Permissions → 加 redirect URL
  - Features → Bot Token Scopes 加所需 scopes

| 步驟 | URL |
|---|---|
| Authorize | `https://slack.com/oauth/v2/authorize?client_id={X}&scope={BOT_SCOPES}&user_scope={USER_SCOPES}&state={STATE}&redirect_uri={URI}` |
| Token | POST `https://slack.com/api/oauth.v2.access` |

**必要 Bot Scopes**：
- `chat:write` — 發訊息
- `chat:write.public` — 發到 bot 沒加入的 public channel
- `channels:read` — 列 public channel（供使用者選擇）
- `groups:read` — 列 private channel（bot 有加入的）
- `users:read` — 對齊 Slack user ↔ kuji team_member aliases
- `users:read.email` — email 比對

**Token 特性**：
- `access_token` 開頭 `xoxb-`（Bot token）
- **不過期** (Slack legacy) 但 2024+ 可選 rotation
- response 含 `team.id`（workspace ID）、`team.name`、`bot_user_id`

**Webhook / push 通知**：
- **Events API**：<https://api.slack.com/apis/connections/events-api>
  - Request URL 需回 URL verification challenge
  - 可訂閱 `message.channels`、`app_mention` 等
- 或用 **Socket Mode**（走 WebSocket，不用對外 URL）— dev 方便

**API 呼叫**：`POST https://slack.com/api/chat.postMessage` with `channel` + `text` or `blocks`

**Kuji 設定彈窗需要的額外資料**：
- GET `/api/conversations.list?types=public_channel,private_channel` → 列 channel → select「預設推送頻道」

---

### 2.3 Google Calendar（以及 Google Meet）

> GCal 和 GMeet 都走 Google OAuth 2.0，同一個 App 用不同 scopes 就能存取。

- **Docs**：<https://developers.google.com/identity/protocols/oauth2/web-server>
- **Auth model**：OAuth 2.0 with PKCE（強烈建議）
- **App 註冊**：GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID
  - 類型選 Web application
  - 加 authorized redirect URI
  - OAuth consent screen 要配置好（App domain、privacy policy URL 等）
  - **驗證**：要用到敏感 scope（`calendar`）時 app 需要通過 Google 的驗證流程（對外服務都要）

| 步驟 | URL |
|---|---|
| Authorize | `https://accounts.google.com/o/oauth2/v2/auth?client_id={X}&redirect_uri={URI}&response_type=code&scope={SCOPES}&access_type=offline&prompt=consent&state={STATE}&code_challenge={CC}&code_challenge_method=S256` |
| Token | POST `https://oauth2.googleapis.com/token` |

**注意**：
- `access_type=offline` 才會回 `refresh_token`
- `prompt=consent` 強制每次都重授權（避免之後拿不到 refresh_token）
- PKCE：自己產 `code_verifier` + `code_challenge=sha256(code_verifier)`；callback 交換時要附 `code_verifier`

**Token 特性**：
- `access_token` 1 小時過期
- 有 `refresh_token`（記得存！長期有效但使用者可撤銷）

**必要 Scopes**：
- GCal：`https://www.googleapis.com/auth/calendar.events`（讀寫事件）+ `calendar.readonly`（列 calendar）
- Google Meet：有兩個選項
  1. 用 Calendar API 建 event 帶 `conferenceData.createRequest.conferenceSolutionKey.type = "hangoutsMeet"` — Meet link 自動產生
  2. 用 **Meet REST API**（2024 GA）：`https://meet.googleapis.com/v2/spaces`，scope `meetings.space.created` / `meetings.space.readonly`

對於 Kuji 錄音用途，真正關鍵的是**錄音存取**：
- GCP 有 **Google Meet Media API**（2024 GA）支援直接從 Meet 拿音訊串流，但要 **Workspace domain admin** 授權
- 或者退而求其次走 Google Drive：Meet 結束後 host 端若有開錄音，錄音會存在 Drive。需 scope `drive.file`（存取 Meet 產生的檔案）

**Kuji 設定彈窗需要的額外資料**：
- GET `https://www.googleapis.com/calendar/v3/users/me/calendarList` → 列 calendar → select「同步到哪個行事曆」
- 對 GMeet 可能要多一步：GET `https://meet.googleapis.com/v2/spaces` 列 meeting spaces

---

### 2.4 Microsoft Teams

- **Docs**：<https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow>
- **Auth model**：Microsoft Identity Platform (Entra ID, 舊 Azure AD)，走 OAuth 2.0 + OpenID Connect
- **App 註冊**：Azure Portal → Microsoft Entra ID → App registrations → New registration
  - Supported account types 通常選 **Multitenant**（讓不同組織的 user 都能連）
  - Redirect URI 加 Web → `https://kuji.app/kuji/api/v1/integrations/teams/callback`
  - 申請 **Graph API** permissions

| 步驟 | URL |
|---|---|
| Authorize | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={X}&response_type=code&redirect_uri={URI}&response_mode=query&scope={SCOPES}&state={STATE}` |
| Token | POST `https://login.microsoftonline.com/common/oauth2/v2.0/token` |

**注意**：URL 裡的 `/common/`（或 `/organizations/`）表示多租戶；單一租戶則填 tenant GUID。

**必要 Scopes**（Graph API）：
- `OnlineMeetings.Read` / `OnlineMeetings.ReadWrite` — 讀 / 建會議
- `Chat.Read` — 讀聊天（抽取 action items）
- `User.Read` — 基本身份
- `offline_access` — 取得 `refresh_token`
- `CallRecords.Read.All`（application permission）— 讀 call recording，**需 admin consent**

**Token 特性**：
- `access_token` 預設 1 小時，長期上限 24 小時（tenant admin 可設）
- `refresh_token` 預設 90 天

**Webhook / push 通知**：
- **Microsoft Graph Change Notifications**：訂閱 `chats/getAllMessages`、`/communications/onlineMeetings/` 等 resource，推到 Kuji 的 webhook endpoint
- 訂閱 lifecycle：最多 60 分鐘過期（chat messages 是這樣），要定期 renew

**取錄音**：
- Teams 會議錄音存在 **OneDrive for Business**（host 的）或 **SharePoint**（channel meeting）
- 取：Graph `GET /communications/callRecords/{id}` 拿 recording URL → 用 access_token 下載

**Kuji 設定彈窗需要的額外資料**：
- GET `/me/calendar/calendarView` 列最近的 Teams 會議
- 偏好開關：「自動錄下所有會議」vs「只有被 @mention 時」

---

### 2.5 Zoom

- **Docs**：<https://developers.zoom.us/docs/integrations/oauth/>
- **Auth model**：OAuth 2.0 (Authorization Code)
- **App 註冊**：<https://marketplace.zoom.us/develop/create> → OAuth App
  - Type 選 **Account-level** 或 **User-managed**（Kuji 用 user-managed — 每個 user 連自己的 Zoom）
  - Production 對外用要申請 Zoom App Marketplace 驗證

| 步驟 | URL |
|---|---|
| Authorize | `https://zoom.us/oauth/authorize?response_type=code&client_id={X}&redirect_uri={URI}&state={STATE}` |
| Token | POST `https://zoom.us/oauth/token` (Basic auth: `base64(client_id:client_secret)`) |

**必要 Scopes**：
- `meeting:read` — 讀會議 metadata
- `meeting:write` — 建立會議（可選）
- `recording:read` — 讀錄音
- `user:read` — user info
- `webinar:read` — 如果要支援 webinar

**Token 特性**：
- `access_token` 1 小時
- `refresh_token` 無期限（但使用 refresh 時會回新的 refresh_token，舊的失效 — 要覆蓋存）

**Webhook / push 通知**：
- OAuth App 可以註冊 **Event Subscriptions**
- 常用 events：`meeting.ended`、`recording.completed`
- Verification：Zoom 會發驗證 request，要回包含 `plainToken` + hash 的 JSON

**取錄音**：
- `meeting.ended` webhook 觸發後，等 `recording.completed` event（可能延遲數分鐘）
- GET `/meetings/{id}/recordings` 拿錄音 URL
- 下載用 `Authorization: Bearer {access_token}`

**Kuji 設定彈窗需要的額外資料**：
- 偏好開關：
  - 「所有會議自動錄音」
  - 「只有我是 host 的會議」
  - 「跟特定 email 開的會議」

---

### 2.6 Google Meet

見 **2.3 Google Calendar**（共用 Google OAuth app + scopes）。

關鍵差異：Meet 的錄音存取需要額外的：

- **Workspace admin**：一般個人帳號無法 API 取得 Meet 錄音；只有 Google Workspace **Business Standard+** 方案、且該 admin 授權 domain-wide delegation 才行
- **Meet Media API**：需白名單申請

所以 GMeet provider UI 要誠實告知使用者「需要 Google Workspace Business Standard 以上 + 管理員授權」。

---

## 3. Kuji 後端實作建議（下一步）

### 3.1 DB schema 調整（補到 migration 0005 或另開 0006）

```python
# alembic 0006
op.add_column("integrations", sa.Column("oauth_access_token",  sa.Text(), nullable=True))
op.add_column("integrations", sa.Column("oauth_refresh_token", sa.Text(), nullable=True))
op.add_column("integrations", sa.Column("oauth_token_type",    sa.String(20), nullable=True))
op.add_column("integrations", sa.Column("oauth_expires_at",    sa.DateTime(), nullable=True))
op.add_column("integrations", sa.Column("oauth_scope",         sa.Text(), nullable=True))
op.add_column("integrations", sa.Column("external_workspace_id", sa.String(200), nullable=True))
op.add_column("integrations", sa.Column("external_user_id",      sa.String(200), nullable=True))

op.create_table(
    "integration_oauth_states",
    sa.Column("state", sa.String(64), primary_key=True),
    sa.Column("tenant_id", sa.Integer(), nullable=False),
    sa.Column("user_id", sa.Integer(), nullable=False),
    sa.Column("kind", sa.String(20), nullable=False),
    sa.Column("pkce_verifier", sa.String(128)),
    sa.Column("expires_at", sa.DateTime(), nullable=False),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()")),
)
```

### 3.2 `integration_providers.fields` schema 調整

原本計畫 fields 包含 `integration_token`/`bot_token`（password type）— OAuth 模式不再需要。改成 OAuth 完成**之後**才要使用者補的偏好設定：

- Notion：`tasks_database_id`（select，選項由 backend 動態列 `/v1/search`）、`default_status`
- Slack：`default_channel`（select，動態列）、`post_summary`（checkbox）、`mention_owners`（checkbox）
- GCal：`calendar_id`（select，動態列）、`default_duration`（select）
- Teams：`auto_join_all`（checkbox）
- Zoom：`record_mode`（select：all / host-only / filtered）
- GMeet：大同 GCal

欄位 spec 要加 `dynamic_options_endpoint`（後端動態列選項的 URL）：

```json
{
  "key": "tasks_database_id",
  "type": "select",
  "dynamic_options_endpoint": "/integrations/notion/resources/databases"
}
```

前端讀 `dynamic_options_endpoint` 去後端抓 options。

### 3.3 後端要補的 endpoint

```
GET  /integrations/providers                  # 同現在（spec 列表）
GET  /integrations/{kind}/connect             # → 302 到 provider authorize（含 state + PKCE）
GET  /integrations/{kind}/callback?code&state # 換 token、寫 DB、302 回前端
POST /integrations/{kind}/disconnect          # 清 tokens、connected=false
PUT  /integrations/{kind}                     # 更新 config（偏好設定）— OAuth 完成後才能呼叫
GET  /integrations/{kind}/resources/{type}    # 動態選項列表（channels / databases / calendars）
GET  /integrations                            # 同現在（當前 tenant 的連線列表）
```

### 3.4 Env 配置

```
# auth_service 已有的 GOOGLE_CLIENT_ID 可共用，但最好分開避免 scope 混雜
KUJI_NOTION_CLIENT_ID=
KUJI_NOTION_CLIENT_SECRET=
KUJI_SLACK_CLIENT_ID=
KUJI_SLACK_CLIENT_SECRET=
KUJI_GOOGLE_CLIENT_ID=
KUJI_GOOGLE_CLIENT_SECRET=
KUJI_ZOOM_CLIENT_ID=
KUJI_ZOOM_CLIENT_SECRET=
KUJI_MS_CLIENT_ID=
KUJI_MS_CLIENT_SECRET=
KUJI_OAUTH_REDIRECT_BASE=https://kuji.app       # callback 外部 URL
KUJI_ENCRYPTION_KEY=                              # 32 bytes base64，加密 oauth_token 用
```

### 3.5 Token 加密（最小可行）

初期用 PostgreSQL `pgcrypto` 的 symmetric encryption：

```sql
-- 寫入
INSERT INTO integrations (..., oauth_access_token)
VALUES (..., pgp_sym_encrypt($1, current_setting('kuji.encryption_key')));

-- 讀取
SELECT pgp_sym_decrypt(oauth_access_token::bytea, current_setting('kuji.encryption_key'))
FROM integrations WHERE kind = $1 AND tenant_id = $2;
```

每個 request 前 `SET LOCAL kuji.encryption_key = '...'`（類似現在 `app.current_user`），加密 key 從環境變數讀取。

進階版改 GCP KMS envelope encryption（DEK per row，KEK 由 KMS 管）。

---

## 4. 實作順序建議

Phase A（skeleton + 單家驗證）：
1. 擴 `integrations` 加 OAuth 欄位 + 建 `integration_oauth_states`
2. 改 `integration_providers.fields` schema（加 `dynamic_options_endpoint`）
3. 實作 Notion 一家的 `/connect` + `/callback` + `/resources/databases`（Notion 最簡單：無 refresh、無 PKCE）
4. 前端：點 Connect 直接 window.location = `/kuji/api/v1/integrations/notion/connect`；callback 完成後 backend redirect 回前端帶 `?connected=notion`；前端彈「請選擇 tasks database」設定彈窗

Phase B（擴充到其他家 + 刷新機制）：
5. Slack（簡單、token 不過期）
6. Zoom（要處理 refresh_token rotation）
7. Google（要 PKCE + refresh_token）
8. Microsoft（scope 最複雜、需 admin consent）
9. 建 cron：`integration_oauth_states` 過期清除；`integrations.oauth_expires_at` 快到期時提前 refresh

Phase C（實際取錄音）：
10. Webhook endpoints（`/webhook/slack`、`/webhook/zoom`、`/webhook/teams`）
11. 處理 meeting.ended → 下載錄音 → 丟 ASR queue
12. 路由規則 engine（把前端設計的 routing rules 落地）

---

## 5. 參考連結整理

| Provider | Docs |
|---|---|
| Notion       | <https://developers.notion.com/docs/authorization> |
| Slack        | <https://api.slack.com/authentication/oauth-v2> |
| Slack Events | <https://api.slack.com/apis/connections/events-api> |
| Google OAuth | <https://developers.google.com/identity/protocols/oauth2/web-server> |
| Google Meet API | <https://developers.google.com/meet/api/guides/overview> |
| MS Identity Platform | <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow> |
| MS Graph Teams | <https://learn.microsoft.com/en-us/graph/teams-concept-overview> |
| Zoom OAuth | <https://developers.zoom.us/docs/integrations/oauth/> |
| Zoom Webhooks | <https://developers.zoom.us/docs/api/webhooks/> |
