# Kuji 技術架構

> 酷記 Kuji — 會議錄音 → 轉寫 → AI 抽行動事項 → 自動分派到 Notion / Slack / Calendar 的 SaaS 產品。
>
> 本文件描述 MVP（UI skeleton + mock data）的前後端服務結構、與既有 `auth_service` 的整合方式、以及 docker-compose / nginx 配線。正式功能（ASR、LLM 抽取、第三方整合）後續補。

---

## 1. 範圍與定位

### Scope（MVP）

本階段只做 **UI skeleton + mock data + CRUD API**：

- Frontend 做到 pixel-level 還原 `Kuji Frontend.html`，兩個 variant（A/B）都實作並提供 toggle。
- Backend 提供標準 REST CRUD，資料層走真實 DB（Postgres），**不**接 ASR / LLM / 第三方整合。
- 使用者登入走既有 `auth_service`，新增 `kuji_user` 角色 + 對應 IAM policy。

### 非範圍（Out of Scope）

- 錄音音檔上傳 + ASR 轉寫（`/record`、`/upload` 頁面做 UI，API 接受 payload 但不跑 ASR）
- LLM 抽行動事項（tasks 表直接接受 POST，不 run AI pipeline）
- Notion / Slack / Google Calendar / Teams / Zoom 實際串接（`/integrations` 頁面是靜態 card grid + toggle）
- Billing / Usage metering
- Real-time 錄音 streaming

---

## 2. 兩個新服務

### `kuji_backend`（FastAPI，抄 `main_service` pattern）

| 項目 | 值 |
|---|---|
| 語言 / 框架 | Python 3.11 + FastAPI + SQLAlchemy 2.0 async + asyncpg + Alembic |
| 容器 port | 8000（host `:8004`） |
| DB | **獨立資料庫 `kuji_db`**（同一個 Postgres 實例，與 `auth_db` / `app_db` 並列；`sql/init-dev.sql` 補 `CREATE DATABASE kuji_db`） |
| 認證 | **不自己驗 JWT**，只讀 nginx 注入的 `X-User-Id / X-User-Role / X-Tenant-Id` |
| 多租戶 | 所有業務表含 `tenant_id NOT NULL`，跟現有 `main_service` 同模型 |
| 稽核欄位 | 所有表含 `created_by / updated_at / updated_by / deleted_at / deleted_by`，由 `audit_autofill()` trigger 自動填 |

#### DB Schema（初版）

**獨立資料庫 `kuji_db`**（與 `auth_db` / `app_db` 同階層）。跨庫不做 FK，`auth_user_id` 之類只當應用層 ID 映射。皆帶 `tenant_id` + audit 欄位。

| 表 | 主要欄位 |
|---|---|
| `meetings` | `id, tenant_id, title, scheduled_at, started_at, ended_at, duration_sec, speaker_count, status (recording/processing/done), source (record/upload/zoom/teams/meet)` |
| `transcript_segments` | `id, tenant_id, meeting_id, speaker_id (S1..Sn), speaker_name, start_ms, end_ms, text, highlight (task/decision/question/null)` |
| `tasks` | `id, tenant_id, meeting_id, source_segment_id, title, status (todo/doing/done), owner_user_id (→ auth_db.users.id，應用層映射), due_at, due_label, tag (notion/slack/gcal/email/teams/github), priority (high/med/low), source_quote, ai_confidence` |
| `integrations` | `id, tenant_id, kind (notion/slack/gcal/...), connected, workspace_label, connected_at` |
| `team_members` | `id, tenant_id, auth_user_id (→ auth_db.users.id), display_name, aliases JSONB` |

稽核 trigger `audit_autofill()` 需要在 `kuji_db` 裡自己建一份（跟 `app_db` 的那份內容一樣，但是不同資料庫間 function 不共享）。

> 這些表先放骨架；後續接真功能時會補 `audio_blob_url`、`webhook_secret` 等欄位。

#### API 路由（nginx 剝 prefix 後）

| Method | URL | 用途 |
|---|---|---|
| GET | `/meetings` | 列出；支援 `?status=`, `?date=` |
| POST | `/meetings` | 建立（mock：給空 transcript 的 recording 狀態） |
| GET | `/meetings/{id}` | 單一會議含 transcript + tasks |
| PATCH | `/meetings/{id}` | 更新標題 / 狀態 |
| GET | `/tasks` | 列出；支援 `?status=`, `?owner=`, `?meeting=` |
| POST | `/tasks` | 手動新增 |
| PATCH | `/tasks/{id}` | 改狀態 / owner / due |
| DELETE | `/tasks/{id}` | soft delete |
| GET | `/integrations` | 列出 |
| POST | `/integrations/{kind}/toggle` | mock connect / disconnect |
| GET | `/team/members` | 列出成員（讀 `auth_db.users` + 本地 aliases） |
| GET | `/me` | 當前 user 在 kuji 的 profile summary |

### `kuji_frontend`（Next.js 14，抄 `frontend` pattern）

| 項目 | 值 |
|---|---|
| 框架 | Next.js 14 App Router + TypeScript + Tailwind 3 |
| 容器 port | 3000（host `:3002`） |
| API base | `/kuji/api/v1` |
| Auth | cookie-based（與 `auth_service` 同一組 httpOnly cookie），401 走 `/auth/v1/refresh` |
| 字型 | Inter Tight + Noto Sans TC + JetBrains Mono（跟設計一致） |

#### 路由

```
src/app/
├── login/page.tsx          # LoginA + LoginB toggle
├── (app)/                  # 有 sidebar 的主 layout
│   ├── layout.tsx          # KSidebar + KTopbar + 中央 main
│   ├── board/page.tsx      # Action Board (BoardA/BoardB toggle)
│   ├── meetings/page.tsx   # 會議列表
│   ├── meetings/[id]/page.tsx  # MeetingA/MeetingB toggle
│   ├── record/page.tsx     # RecordA/RecordB toggle
│   ├── upload/page.tsx     # UploadA/UploadB toggle
│   ├── tasks/[id]/page.tsx # TaskA/TaskB toggle
│   ├── integrations/page.tsx
│   ├── team/page.tsx
│   └── account/page.tsx
├── onboarding/page.tsx     # OnboardingA/OnboardingB toggle
└── page.tsx                # root → redirect /board or /login
```

#### Variant 切換

右上角 `Tweaks` 面板（與設計一致）提供：
- **Variant**：A / B
- **Theme**：dark / light
- **Language**：中文 / English

切換值存 `localStorage`，全域 `<KujiPrefs>` context 廣播。

---

## 3. 整合 `auth_service`

### 新增 `kuji_user` 角色

在 `auth_service/migrations/` 新增 migration（例如 `000026_kuji_role.up.sql`）：

1. `INSERT INTO services (name, prefix) VALUES ('kuji', '/kuji/api/v1')`
2. 新增 `action_mappings`：
   - `GET /meetings` → `kuji:meeting:read`
   - `POST /meetings` → `kuji:meeting:write`
   - `PATCH /meetings/{id}` → `kuji:meeting:write`
   - `GET /tasks` → `kuji:task:read`
   - `POST /tasks`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}` → `kuji:task:write`
   - `GET /integrations`, `POST /integrations/{kind}/toggle` → `kuji:integration:*`
   - `GET /team/members` → `kuji:team:read`
   - `GET /me` → `kuji:self:read`
3. `INSERT INTO roles (name) VALUES ('kuji_user')`
4. `INSERT INTO policies (name, document)` — `kuji-user-policy`：
   ```json
   {
     "Statement": [{
       "Effect": "Allow",
       "Action": ["kuji:*"],
       "Resource": ["kuji:tenant/${auth:tenant_id}/*"]
     }]
   }
   ```
5. `INSERT INTO role_policies (role_id, policy_id)` 綁定
6. Seed 一個 dev user（例如 `demo@kuji.local` / `demo123`，tenant_id=1、role=kuji_user）

### 登入流程

1. 使用者進 `/kuji/login`（kuji_frontend 的 LoginA/B）
2. 輸入 email/password → POST `/auth/v1/password-login`（既有 endpoint）
3. `auth_service` 驗證 → 發 JWT 放 httpOnly cookie
4. 前端收到 `{role, user_id}` → resolvePostLogin：role=kuji_user → `/kuji/board`
5. 之後所有 `/kuji/api/v1/*` 請求，nginx auth_request 驗證 → 注入 identity header → `kuji_backend` 讀 header

### Google SSO（可選）

既有 `/auth/v1/google` 已支援。只要 `auth_identities` 有綁定 record，Google 登入回傳 role=kuji_user 就能用。

---

## 4. Nginx 路由

新增到 `nginx/nginx.conf`：

```nginx
# Kuji API（auth_request 驗證）
location /kuji/api/v1/ {
    auth_request        /auth/verify;
    auth_request_set    $user_id    $upstream_http_x_user_id;
    auth_request_set    $user_role  $upstream_http_x_user_role;
    auth_request_set    $tenant_id  $upstream_http_x_tenant_id;
    proxy_set_header    X-User-Id   $user_id;
    proxy_set_header    X-User-Role $user_role;
    proxy_set_header    X-Tenant-Id $tenant_id;
    rewrite             ^/kuji/api/v1/(.*) /$1 break;
    proxy_pass          http://kuji_backend:8000;
}

# Kuji 登入頁（不擋）
location /kuji/login {
    proxy_pass http://kuji_frontend:3000;
    # upgrade headers...
}

# Kuji 前端（登入後；頁面層驗證）
location /kuji/ {
    auth_request        /auth/verify-page;
    error_page 401 = @kuji_login_redirect;
    proxy_pass          http://kuji_frontend:3000;
}

location @kuji_login_redirect { return 302 /kuji/login; }
```

---

## 5. docker-compose 新增

`docker-compose.dev.yml`：

```yaml
  kuji_backend:
    build: { context: ./kuji_backend, dockerfile: Dockerfile }
    ports: ["8004:8000"]
    env_file: ./kuji_backend/.env.docker
    depends_on: { postgres: { condition: service_healthy } }
    profiles: ["full"]

  kuji_frontend:
    build: { context: ./kuji_frontend, dockerfile: Dockerfile }
    ports: ["3002:3000"]
    env_file: ./kuji_frontend/.env.docker
    depends_on: [kuji_backend]
    profiles: ["full"]
```

`nginx` 的 `depends_on` 加上 `kuji_backend / kuji_frontend`。

---

## 6. Port 總覽（更新後）

| 服務 | Container | Host |
|---|---|---|
| postgres | 5432 | 5433 |
| redis | 6379 | 6380 |
| auth_service | 8001 | 8003 |
| main_service | 8000 | 8002 |
| **kuji_backend** | 8000 | **8004** |
| frontend | 3000 | 3001 |
| **kuji_frontend** | 3000 | **3002** |
| nginx | 80 | 8080 |

所有瀏覽器端走 `http://localhost:8080/kuji/...`，nginx 分流。

---

## 7. 實作順序（checklist）

1. [x] 建 `docs/kuji-architecture.md`（本檔）+ feature branch `feature/kuji-app`
2. [ ] 更新 `sql/init-dev.sql`：加 `CREATE DATABASE kuji_db`
3. [ ] auth_service migration 000026：kuji service / action_mappings / role / policy / dev user
4. [ ] `kuji_backend/` 骨架：`main.py / database.py / deps.py / models / routers / alembic`，複用 main_service 同 pattern
5. [ ] Alembic migrations（`kuji_db`）：0001 init schema（5 張表），0002 audit columns + trigger
6. [ ] Mock data seed：demo tenant 的 meetings / tasks / transcript / integrations
7. [ ] `kuji_frontend/` 骨架：Next.js 14 app router，`package.json / tsconfig / tailwind / next.config`
8. [ ] 拆 `Kuji Frontend.html` 為 React 元件：`lib/ds/`（KIcon、KBtn、KBadge、KAvatar、KCard、KSidebar、KTopbar、kTheme 等）
9. [ ] 頁面實作（每頁 A/B toggle）：login → board → meetings → meeting detail → record → upload → task detail → integrations → team → account → onboarding
10. [ ] `lib/api.ts`、`lib/auth.ts`、`lib/prefs.ts`（variant/theme/lang context）
11. [ ] nginx.conf 加 kuji 路由
12. [ ] docker-compose 加 kuji_backend / kuji_frontend
13. [ ] 整合測試：啟動 `--profile full`，用 dev user 登入走一圈 Board → Meeting → Task

---

## 8. 未來擴充（Phase 2+）

- **ASR**：`/record` 接 WebSocket 給 kuji_backend，backend 轉接 Gemini Live / Whisper
- **LLM 抽取**：meeting status=`processing` 時 enqueue Cloud Tasks → Gemini 2.5 Pro 抽 tasks
- **整合實作**：Notion / Slack / Calendar 用 OAuth 2.0，token 存 `kuji.integrations.oauth_token` 加密欄位
- **RLS policy**：確認 kuji 表也跟 main_service 一樣走 app_user role
- **Metering**：`kuji.usage_log` 記每個 tenant 的 transcribed minutes，月底對 `Team` / `Enterprise` 方案計費

---

## 附錄：設計檔案來源

- 原始設計：`Kuji Frontend.html`（Claude Design 匯出）
- 資料示意：`KUJI_DATA` mock（inline 在 HTML 的 `ds.jsx` block，約 line 556）
- 設計 tokens：`KUJI_THEME.dark / .light`，accent 預設 `#60a5fa`
