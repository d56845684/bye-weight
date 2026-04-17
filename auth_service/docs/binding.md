# 先建後綁（Pre-create + Bind）流程

管理員在後台先建好 `users` row（含 `display_name` / `role` / `clinic_id`），系統產生一組有效期 7 天的 binding token。把 token 包成 LIFF 連結或 QR 給使用者，使用者在 LINE 內開啟即可綁定自己的 LINE UUID，之後就能用 LINE 登入。

## 流程圖

```
Admin                          auth_service             Redis           使用者
  │                                  │                     │               │
  │ POST /auth/admin/users           │                     │               │
  │────────────────────────────────→│                     │               │
  │                                  │ INSERT users         │               │
  │                                  │ (line_uuid=NULL)     │               │
  │                                  │ SET bind:{token}=id  │               │
  │                                  │─────────────────────→│               │
  │ ← {binding_token, binding_url}   │                     │               │
  │                                  │                     │               │
  │ 傳 URL / QR 給使用者             │                     │               │
  │─────────────────────────────────────────────────────────────────────→│
  │                                                                        │
  │                                       使用者在 LINE 內打開連結       │
  │                                  │← POST /auth/line-bind               │
  │                                  │  {access_token, binding_token}      │
  │                                  │                     │               │
  │                                  │ verify LINE token   │               │
  │                                  │ → 取得 line_uuid    │               │
  │                                  │ GET bind:{token}────→│               │
  │                                  │← user_id             │               │
  │                                  │ UPDATE users          │               │
  │                                  │  SET line_uuid        │               │
  │                                  │ DEL bind:{token}─────→│              │
  │                                  │                      │               │
  │                                  │ 發 JWT cookie + 寫 login_logs       │
  │                                  │──────────────────────────────────→│
```

## API

### POST /auth/admin/users — 建 user 並產 token

需要 `user:write` permission（super_admin 才有）。

**Request**
```json
{ "display_name": "王小明", "role": "patient", "clinic_id": "C001" }
```
- `role` 省略時預設 `patient`
- `clinic_id` 必填，格式 `^[A-Za-z0-9_-]{1,20}$`

**Response 201**
```json
{
  "user_id": 14,
  "binding_token": "DovmioLiBlLcRkoULzJB0Bxz8F5gPvFI",
  "binding_url": "/liff?token=DovmioLiBlLcRkoULzJB0Bxz8F5gPvFI",
  "expires_at": "2026-04-24T06:43:59Z"
}
```

> 若環境變數 `LIFF_ID` 有設，`binding_url` 會組成 `https://liff.line.me/{LIFF_ID}?token=...`，admin 前端可以直接當 URL 用，沒設就前端自己補 domain。

### POST /auth/admin/users/{id}/binding-token — 重產

使用者用的連結過期、或不小心弄丟時，admin 可重發。**已綁 LINE 的 user 不能重產**（回 409）。

### POST /auth/line-bind — 使用者端綁定

`/liff` 頁偵測到 URL 帶 `?token=xxx` 就走這條（否則走 `/auth/line-token` 一般登入）。

**Request**
```json
{ "access_token": "LINE_ACCESS_TOKEN", "binding_token": "jvS4..." }
```

**可能的錯誤**

| Status | 意思 |
|:---:|------|
| 401 | LINE access token 無效 |
| 410 | binding token 已過期或不存在 |
| 409 | 這 user 已綁過別的 LINE，或這 LINE UUID 已綁到別人 |

### PATCH /auth/admin/users/{id} — 改 user

可更新：`display_name` / `role` / `clinic_id` / `active`。若把 role 從 `patient` 換成其他，會自動把 `patient_id` 清為 NULL。

## Binding status（列表上顯示）

| status | 條件 |
|--------|------|
| `bound` | `line_uuid IS NOT NULL` |
| `password_only` | `line_uuid IS NULL AND google_email IS NOT NULL`（只有後台密碼登入，未綁 LINE）|
| `pending` | 兩者皆 NULL，等待使用者綁定 |

## 稽核（login_logs）

以下登入方式成功時會寫一筆：
- `password` — `/auth/password-login`
- `line` — `/auth/line-token`
- `line_bind` — `/auth/line-bind`
- `dev` — `/auth/dev-login`（僅 dev 環境）

欄位：`user_id` / `ip`（從 X-Forwarded-For / X-Real-IP / RemoteAddr 取）/ `user_agent`（前綴登入方式，方便查詢）。
