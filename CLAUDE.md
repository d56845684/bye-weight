# 系統架構技術規格

> 專案：LINE 醫療病患追蹤平台 MVP  
> 版本：1.3  
> 最後更新：（請填入日期）

---

## 目錄

1. [整體架構](#1-整體架構)
2. [基礎設施規格](#2-基礎設施規格)
3. [應用程式層](#3-應用程式層)
4. [資料層](#4-資料層)
5. [快取層（Redis）](#5-快取層redis)
6. [外部服務整合](#6-外部服務整合)
7. [網路與安全](#7-網路與安全)
   - [7.2 Token 安全設計（JWT + HttpOnly Cookie + Blacklist）](#72-token-安全設計)
7A. [Auth 微服務](#7a-auth-微服務)
8. [環境變數清單](#8-環境變數清單)
9. [開發環境建置](#9-開發環境建置)
10. [部署流程](#10-部署流程)
11. [高可用方案（HA）對照](#11-高可用方案ha對照)

---

## 1. 整體架構

```
使用者（LINE App / Web 瀏覽器）
    ↓ HTTPS
Cloudflare DNS  →  Cloud Load Balancer（固定 IP + GCM 憑證）
    ↓
Compute Engine VM  e2-standard-2  ubuntu-22.04  asia-east1
  └── Docker Compose（統一管理所有容器）
        ├── nginx        Nginx:alpine（port 80）反向代理 + auth_request
        │     ├── /auth/*  → auth_service:8001
        │     ├── /api/*   → main_service:8000（每個 request 先驗證）
        │     └── /        → frontend:3000
        ├── auth_service  Go 1.22 + chi（port 8001）← RBAC/PBAC 判斷引擎
        ├── main_service  Python FastAPI + Gunicorn（port 8000）
        ├── frontend      Next.js（port 3000）
        └── redis         Redis:7-alpine（port 6379）
              ├── auth:blacklist:{jti}   撤銷的 JWT
              └── cache:{resource}:{id}  API 快取
    ↓ 內網
Cloud SQL PostgreSQL 15  asia-east1（同一實例，兩個 Database）
  ├── auth_db  users / roles / permissions / role_permissions / policies / policy_conditions
  └── app_db   patients / visits / inbody / food_logs / ...
Cloud Storage Standard   asia-east1

外部 API
  ├── LINE Messaging API（Push / Webhook）
  ├── Gemini 2.5 Flash（圖片辨識 OCR）
  └── Cloud Scheduler（每日 09:00 觸發）
```

---

## 2. 基礎設施規格

### 2.1 Compute Engine VM

| 項目 | 值 |
|------|-----|
| 機型 | `e2-standard-2` |
| vCPU | 2 |
| RAM | 8 GB |
| OS | Ubuntu 22.04 LTS |
| 磁碟 | pd-balanced 50 GB |
| 區域 | `asia-east1-b` |
| 靜態 IP | 透過 Cloud Load Balancer 提供 |

**Docker Compose 服務清單**

| 服務名稱 | Image | Port | 說明 |
|---------|-------|-----:|------|
| `nginx` | `nginx:alpine` | 80 | 反向代理 + auth_request 驗證 |
| `auth_service` | 自建 Go image | 8001 | JWT 發行 / 驗證 / RBAC / PBAC |
| `main_service` | 自建 Python image | 8000 | 業務邏輯 API（Gunicorn）|
| `frontend` | 自建 Next.js image | 3000 | 前端 SSR |
| `redis` | `redis:7-alpine` | 6379 | JWT blacklist + API 快取 |

> Cloud SQL Auth Proxy 以 sidecar container 方式加入 compose，  
> 讓 `auth_service` 和 `main_service` 透過 unix socket 連線 Cloud SQL。

### 2.2 Cloud Load Balancer

| 項目 | 值 |
|------|-----|
| 類型 | Global External HTTP(S) Load Balancer |
| 協定 | HTTPS（HTTP 自動導向 HTTPS）|
| 憑證 | GCM Google Managed Certificate（自動續約）|
| Health Check | HTTP `/api/health`，間隔 10 秒，閾值 2 次失敗 |
| Backend | Instance Group（VM）|

> **注意**：LB 終止 TLS 後以 HTTP 轉發到 VM 的 Nginx（port 80）。  
> Nginx 不需要處理憑證，只做反向代理。

### 2.3 Cloud SQL

| 項目 | 值 |
|------|-----|
| 引擎 | PostgreSQL 15 |
| 機型 | `db-custom-1-3840`（1 vCPU，3.75 GB RAM）|
| 儲存 | 20 GB SSD，`--storage-auto-increase` 開啟 |
| 區域 | `asia-east1` |
| 連線方式 | Cloud SQL Auth Proxy（內網，不開放公網）|
| 備份 | 每日 02:00，保留 7 份 |
| 備份指令 | `gcloud sql instances patch INSTANCE --backup-start-time=02:00 --retained-backups-count=7` |

### 2.4 Cloud Storage

| 項目 | 值 |
|------|-----|
| 類型 | Standard Storage |
| 區域 | `asia-east1` |
| 用途 | InBody 圖片、食物照片 |
| 上傳方式 | Presigned URL（前端直傳，不經 VM）|
| 命名規則 | `inbody/{patient_id}/{timestamp}.jpg` / `food/{patient_id}/{timestamp}.jpg` |
| 存取控制 | Uniform bucket-level access，Service Account 授權 |

---

## 3. 應用程式層

### 3.1 Nginx 設定

```nginx
# nginx/nginx.conf（掛載進 nginx container）

server {
    listen 80;
    server_name _;

    # ── 內部 sub_request 驗證端點（不對外）──
    location = /auth/verify {
        internal;
        proxy_pass              http://auth_service:8001/auth/verify;
        proxy_pass_request_body off;               # 不轉發 body，省記憶體
        proxy_set_header        Content-Length "";
        proxy_set_header        Cookie $http_cookie; # 帶 cookie 給 Auth Service
        proxy_set_header        X-Original-URI $request_uri;
    }

    # ── Auth 對外端點（登入 / 登出，不需要 auth_request）──
    location /auth/ {
        proxy_pass         http://auth_service:8001;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # ── 主服務 API（每個 request 先驗證）──
    location /api/ {
        auth_request        /auth/verify;

        # 驗證通過後，Auth Service 回傳的 user 資訊注入給主服務
        auth_request_set    $user_id    $upstream_http_x_user_id;
        auth_request_set    $user_role  $upstream_http_x_user_role;
        auth_request_set    $patient_id $upstream_http_x_patient_id;

        proxy_set_header    X-User-Id    $user_id;
        proxy_set_header    X-User-Role  $user_role;
        proxy_set_header    X-Patient-Id $patient_id;

        rewrite             ^/api/(.*) /$1 break;
        proxy_pass          http://main_service:8000;
        proxy_set_header    Host $host;
        proxy_set_header    X-Real-IP $remote_addr;
        proxy_set_header    X-Forwarded-Proto $scheme;
    }

    # ── 前端 Next.js ──
    location / {
        proxy_pass         http://frontend:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3.2 Next.js 前端

| 項目 | 值 |
|------|-----|
| 框架 | Next.js 14（App Router）|
| CSS | Tailwind CSS |
| 套件管理 | pnpm |
| 程序管理 | PM2（`ecosystem.config.js`）|
| Port | 3000 |
| Build | `pnpm build && pm2 restart frontend` |

**角色路由設計**

| 角色 | 路徑前綴 | 身份驗證方式 |
|------|---------|------------|
| 病患 | `/patient/*` | LINE token → JWT（HttpOnly Cookie）|
| 員工 | `/staff/*` | LINE token → JWT（HttpOnly Cookie）|
| 營養師 | `/nutritionist/*` | Google OAuth → JWT（HttpOnly Cookie）|
| 管理員 | `/admin/*` | Google OAuth → JWT + role check |

**LIFF → Web 身份驗證橋接**

```
LIFF 呼叫 liff.getAccessToken()
    ↓ POST /auth/line-token（帶 LINE Access Token）
Auth Service 向 LINE 驗證 token，取得 line_uuid
    ↓ 查 auth_db.users，取得 user_id / role / patient_id
    ↓ 發行 JWT（payload: user_id, role, patient_id, jti）
    ↓ Access Token  TTL 15 分鐘，存 HttpOnly Cookie
    ↓ Refresh Token TTL 7 天，存 HttpOnly Cookie（獨立 path）
後續 API 請求瀏覽器自動帶 cookie，JS 完全讀不到 token
    ↓ Nginx auth_request → Auth Service 驗證
    ↓ 通過後以 X-User-Id / X-User-Role header 傳給主服務
Access Token 到期 → 前端呼叫 POST /auth/refresh 換新 token
```

> JWT 存 HttpOnly Cookie，JS 完全讀不到，XSS 無法竊取。

**主要頁面清單**

| 頁面 | 路徑 | 角色 |
|------|------|------|
| 飲食記錄 | `/patient/food-logs` | 病患 |
| InBody 趨勢 | `/patient/inbody` | 病患 |
| 看診紀錄 | `/patient/visits` | 病患 |
| 通知設定 | `/patient/notifications` | 病患 |
| 手動推播 | `/nutritionist/push` | 營養師 |
| 病患管理 | `/admin/patients` | 管理員 |

### 3.3 FastAPI 後端

| 項目 | 值 |
|------|-----|
| 框架 | FastAPI 0.110+ |
| Python | 3.11 |
| 程序管理 | Gunicorn + UvicornWorker |
| Workers | 4（`-w 4`）|
| Port | 8000 |
| ORM | SQLAlchemy 2.0（async）|
| DB 連線 | asyncpg（PostgreSQL）|
| 文件 | `/api/docs`（Swagger UI）|

**Gunicorn 啟動指令**

```bash
gunicorn main:app \
  -w 4 \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 120 \
  --access-logfile /var/log/fastapi/access.log \
  --error-logfile  /var/log/fastapi/error.log
```

**systemd 設定**

```ini
# /etc/systemd/system/fastapi.service
[Unit]
Description=FastAPI Backend
After=network.target redis.service

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/backend
EnvironmentFile=/home/ubuntu/backend/.env
ExecStart=/usr/local/bin/gunicorn main:app \
  -w 4 -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

**API 路由結構**

```
/health                      GET   Health check（LB 用）
/auth/line-token             POST  LINE token 換 session
/bind                        POST  病患綁定 LINE 帳號
/patients/{id}               GET   病患基本資料
/visits                      GET   看診紀錄列表
/visits/{id}/medications     GET   用藥明細
/inbody                      POST  上傳 InBody（員工用）
/inbody/history              GET   InBody 歷史趨勢
/food-logs                   POST  新增飲食記錄
/food-logs                   GET   飲食記錄列表
/upload/presigned-url        POST  取得圖片上傳 presigned URL
/notification-rules          POST  建立通知規則
/notification-rules/{id}     PATCH 修改通知規則
/notification-rules/{id}     DELETE 停用通知規則
/notify/manual               POST  手動推播（營養師用）
/internal/notify/run         POST  排程觸發入口（Cloud Scheduler 呼叫）
```

---

## 4. 資料層

### 4.1 資料庫 Schema（10 張表）

```sql
-- 員工白名單（與病患完全獨立）
CREATE TABLE employees (
    id         SERIAL PRIMARY KEY,
    line_uuid  VARCHAR(64) UNIQUE NOT NULL,
    name       VARCHAR(20),
    clinic_id  VARCHAR(20),
    role       VARCHAR(20) DEFAULT 'staff',  -- staff / nutritionist / admin
    active     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 病患主檔
CREATE TABLE patients (
    id         SERIAL PRIMARY KEY,
    his_id     VARCHAR(20),                  -- 預留，將來對應 HIS
    name       VARCHAR(20) NOT NULL,
    sex        CHAR(1),
    birth_date DATE NOT NULL,
    phone      VARCHAR(20),
    email      VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- LINE 綁定（病患 ↔ LINE UUID）
CREATE TABLE line_bindings (
    id         SERIAL PRIMARY KEY,
    patient_id INT REFERENCES patients(id),
    line_uuid  VARCHAR(64) UNIQUE NOT NULL,
    clinic_id  VARCHAR(20),
    bound_at   TIMESTAMP DEFAULT NOW()
);

-- 就診紀錄
CREATE TABLE visits (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    visit_date     DATE NOT NULL,
    doctor_id      VARCHAR(20),
    notes          TEXT,
    next_visit_date DATE,
    created_at     TIMESTAMP DEFAULT NOW()
);

-- 用藥明細
CREATE TABLE medications (
    id         SERIAL PRIMARY KEY,
    visit_id   INT REFERENCES visits(id),
    drug_name  VARCHAR(100),
    frequency  VARCHAR(20),
    days       INT,
    start_date DATE,
    end_date   DATE
);

-- InBody 主表
CREATE TABLE inbody_records (
    id            SERIAL PRIMARY KEY,
    patient_id    INT REFERENCES patients(id),
    uploaded_by   INT REFERENCES employees(id),
    measured_at   TIMESTAMP NOT NULL,
    weight        NUMERIC(5,2),
    bmi           NUMERIC(4,2),
    body_fat_pct  NUMERIC(4,2),
    muscle_mass   NUMERIC(5,2),
    visceral_fat  INT,
    metabolic_rate NUMERIC(6,0),
    image_url     TEXT,
    raw_json      JSONB,
    match_status  VARCHAR(20) DEFAULT 'matched', -- matched / ambiguous / unmatched
    created_at    TIMESTAMP DEFAULT NOW()
);

-- InBody OCR 比對緩衝區
CREATE TABLE inbody_pending (
    id            SERIAL PRIMARY KEY,
    uploaded_by   INT REFERENCES employees(id),
    image_url     TEXT,
    ocr_name      VARCHAR(20),
    ocr_birth_date DATE,
    ocr_data      JSONB,
    status        VARCHAR(20) DEFAULT 'pending', -- pending / confirmed / rejected
    uploaded_at   TIMESTAMP DEFAULT NOW()
);

-- 飲食記錄
CREATE TABLE food_logs (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    logged_at      TIMESTAMP NOT NULL,
    meal_type      VARCHAR(10),               -- breakfast / lunch / dinner / snack
    image_url      TEXT,
    food_items     JSONB,
    total_calories NUMERIC(6,1),
    total_protein  NUMERIC(5,1),
    total_carbs    NUMERIC(5,1),
    total_fat      NUMERIC(5,1),
    ai_suggestion  TEXT
);

-- 通知規則（每位病患的通知設定）
CREATE TABLE notification_rules (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    type           VARCHAR(20) NOT NULL,      -- revisit / inbody
    days_before    INT,                        -- 回診前 N 天
    interval_days  INT,                        -- InBody 每 N 天
    send_time      TIME DEFAULT '09:00',
    active         BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT NOW()
);

-- 通知發送紀錄
CREATE TABLE notification_logs (
    id              SERIAL PRIMARY KEY,
    patient_id      INT REFERENCES patients(id),
    type            VARCHAR(20),              -- revisit / inbody / manual
    format          VARCHAR(10),              -- text / flex
    message_content TEXT,
    status          VARCHAR(10) DEFAULT 'pending', -- pending / sent / failed
    scheduled_at    TIMESTAMP,
    sent_at         TIMESTAMP,
    line_uuid       VARCHAR(64)
);
```

### 4.2 重要 Index

```sql
-- 登入 / 綁定查詢
CREATE INDEX idx_line_bindings_uuid   ON line_bindings(line_uuid);
CREATE INDEX idx_employees_uuid       ON employees(line_uuid);

-- InBody 趨勢查詢
CREATE INDEX idx_inbody_patient_time  ON inbody_records(patient_id, measured_at DESC);

-- 飲食記錄查詢
CREATE INDEX idx_food_patient_date    ON food_logs(patient_id, logged_at DESC);

-- 通知排程查詢
CREATE INDEX idx_visits_next_visit    ON visits(next_visit_date)
    WHERE next_visit_date IS NOT NULL;
CREATE INDEX idx_notif_rules_active   ON notification_rules(patient_id)
    WHERE active = TRUE;
CREATE INDEX idx_notif_logs_status    ON notification_logs(status, scheduled_at)
    WHERE status = 'pending';
```

---

## 5. 快取層（Redis）

### 5.1 Redis 設定

| 項目 | 值 |
|------|-----|
| 部署方式 | VM 自架（標準方案）/ GCP Memorystore（HA 方案）|
| Port | 6379 |
| 最大記憶體 | 512 MB（`maxmemory 512mb`）|
| 淘汰策略 | `maxmemory-policy allkeys-lru` |
| 持久化 | 關閉（快取資料遺失可重建）|

**`/etc/redis/redis.conf` 關鍵設定**

```conf
bind 127.0.0.1          # 只接受本機連線
maxmemory 512mb
maxmemory-policy allkeys-lru
save ""                 # 關閉 RDB 持久化
appendonly no           # 關閉 AOF 持久化
```

### 5.2 Key 設計

| prefix | Key 格式 | TTL | 說明 |
|--------|---------|----:|------|
| **auth:** | `auth:blacklist:{jti}` | JWT 剩餘有效期 | 已登出 / 撤銷的 JWT |
| **cache:** | `cache:inbody:{patient_id}` | 300s（5min）| InBody 趨勢圖 |
| **cache:** | `cache:food:{patient_id}:{date}` | 300s（5min）| 當日飲食 |
| **cache:** | `cache:visits:{patient_id}` | 300s（5min）| 看診列表 |
| **cache:** | `cache:notif_rules:{patient_id}` | 600s（10min）| 通知設定 |

### 5.3 Cache Invalidation 規則

| 觸發動作 | 清除的 Key |
|---------|-----------|
| 新增 InBody 紀錄 | `inbody:{patient_id}` |
| 新增飲食記錄 | `food:{patient_id}:{date}` |
| 新增 / 更新看診紀錄 | `visits:{patient_id}` |
| 修改通知規則 | `notif_rules:{patient_id}` |

### 5.4 FastAPI 快取裝飾器（實作參考）

```python
# utils/cache.py
import json
import redis.asyncio as aioredis
from functools import wraps

redis_client = aioredis.from_url("redis://redis:6379")

def cache(key_fn, ttl: int = 300):
    """API 回應快取裝飾器"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            key = key_fn(*args, **kwargs)
            cached = await redis_client.get(key)
            if cached:
                return json.loads(cached)
            result = await func(*args, **kwargs)
            await redis_client.setex(key, ttl, json.dumps(result))
            return result
        return wrapper
    return decorator

async def invalidate(key: str):
    await redis_client.delete(key)
```

---

## 6. 外部服務整合

### 6.1 LINE Messaging API

| 項目 | 值 |
|------|-----|
| 計費方案 | 中用量（NT$800/月，3,000 則）|
| Webhook URL | `https://your-domain.com/api/line/webhook` |
| 計費訊息類型 | Push / Multicast / Broadcast |
| 免費訊息類型 | Reply（Webhook 回覆）|

**Webhook 驗證**

```python
import hmac, hashlib, base64

def verify_line_signature(body: bytes, signature: str, secret: str) -> bool:
    hash_ = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    return base64.b64encode(hash_).decode() == signature
```

**InBody 上傳流程（員工）**

```
1. 員工 LINE UUID 驗證（查 employees 表）
2. 圖片存 Cloud Storage → 寫入 inbody_pending
3. 觸發 n8n Webhook → Gemini 2.5 Flash OCR
4. OCR 結果：姓名 + 生日雙欄位比對 patients 表
   ├── 唯一比對 → 寫入 inbody_records，status='matched'
   └── 同名 / 找不到 → inbody_pending status='ambiguous'
                        → LINE 通知員工人工確認
```

### 6.2 Gemini 2.5 Flash

| 項目 | 值 |
|------|-----|
| 模型 | `gemini-2.5-flash` |
| 用途 | InBody 圖片 OCR、食物照片辨識 |
| Input 定價 | $0.30 USD / 1M tokens |
| Output 定價 | $2.50 USD / 1M tokens |
| 每張圖片費用 | Input ~460 tokens + Output ~200 tokens |
| 月費（100人×6張/天）| ~NT$367 |

**呼叫範例**

```python
import google.generativeai as genai

genai.configure(api_key=os.environ["GEMINI_API_KEY"])
model = genai.GenerativeModel("gemini-2.5-flash")

def ocr_inbody(image_bytes: bytes) -> dict:
    response = model.generate_content([
        "請辨識這張 InBody 體組成報告，回傳 JSON 格式：",
        "{ name, birth_date, weight, bmi, body_fat_pct,",
        "  muscle_mass, visceral_fat, metabolic_rate }",
        {"mime_type": "image/jpeg", "data": image_bytes},
    ])
    return json.loads(response.text)
```

### 6.3 Cloud Scheduler

| 項目 | 值 |
|------|-----|
| Job 名稱 | `daily-notification` |
| Cron | `0 9 * * *`（台灣時間 09:00，UTC+8 = UTC 01:00）|
| 目標 URL | `POST https://your-domain.com/api/internal/notify/run` |
| Auth | OIDC token（Service Account）|
| 費用 | 免費（每月 3 個 job 免費）|

**通知觸發邏輯（`/internal/notify/run`）**

```
1. 查詢今日需發送的回診提醒
   SELECT p.*, lb.line_uuid FROM patients p
   JOIN line_bindings lb ON p.id = lb.patient_id
   JOIN visits v ON p.id = v.patient_id
   JOIN notification_rules nr ON p.id = nr.patient_id
   WHERE nr.type = 'revisit' AND nr.active = TRUE
     AND v.next_visit_date = CURRENT_DATE + nr.days_before
     AND NOT EXISTS (
       SELECT 1 FROM notification_logs nl
       WHERE nl.patient_id = p.id
         AND nl.type = 'revisit'
         AND nl.scheduled_at::date = CURRENT_DATE
     )

2. 查詢今日需發送的 InBody 提醒（上次量測超過 interval_days）

3. 寫入 notification_logs（status: pending）

4. 呼叫 LINE Push API 發送 Flex Message

5. 更新 notification_logs（status: sent / failed，sent_at）

6. 失敗者最多重試 3 次（指數退避：30s / 60s / 120s）
```

---

## 7. 網路與安全

### 7.1 防火牆規則（GCP VPC Firewall）

| 規則名稱 | 方向 | 來源 | Port | 說明 |
|---------|------|------|-----:|------|
| allow-lb-to-vm | Ingress | GCP LB health check IP | 80 | LB health check + 流量 |
| allow-ssh | Ingress | 你的 IP | 22 | 管理用，建議限制 IP |
| deny-all-ingress | Ingress | 0.0.0.0/0 | all | 預設拒絕 |

> Redis（6379）、Auth Service（8001）、Main Service（8000）只在 Docker 內部網路通訊，不對外暴露。

### 7.2 Token 安全設計

#### JWT 設計

```python
# JWT payload
{
    "user_id":    42,
    "role":       "patient",       # patient / staff / nutritionist / admin
    "patient_id": 17,              # role=patient 時才有值
    "jti":        "uuid-xxxx",     # 唯一 ID，用於 blacklist 撤銷
    "exp":        now + 900,       # Access Token：15 分鐘
    "iat":        now
}

# Refresh Token payload（單獨發行）
{
    "user_id":    42,
    "jti":        "uuid-yyyy",
    "exp":        now + 604800,    # 7 天
    "type":       "refresh"
}
```

#### Cookie 設定（HttpOnly，防 XSS）

```python
# Auth Service：登入 / 換 token 時設定
response.set_cookie(
    key="access_token",
    value=access_jwt,
    httponly=True,       # JS 完全讀不到
    secure=True,         # 只走 HTTPS
    samesite="Strict",   # 防 CSRF
    max_age=900,         # 15 分鐘
    path="/",
)
response.set_cookie(
    key="refresh_token",
    value=refresh_jwt,
    httponly=True,
    secure=True,
    samesite="Strict",
    max_age=604800,      # 7 天
    path="/auth/refresh", # 只在換 token 時才帶
)
```

#### JWT Blacklist（主動撤銷）

```python
# Auth Service：logout / 強制登出
async def revoke_token(jti: str, exp: int):
    ttl = exp - int(time.time())
    if ttl > 0:
        # TTL = JWT 剩餘有效期，到期後 Redis 自動清除
        await redis.setex(f"auth:blacklist:{jti}", ttl, "1")

# /auth/verify：每次驗證都查一次
async def verify(cookie: str):
    payload = decode_jwt(cookie)              # 驗簽名 + 過期
    is_revoked = await redis.exists(
        f"auth:blacklist:{payload['jti']}"
    )
    if is_revoked:
        raise HTTPException(401, "token revoked")
    return payload
```

#### 威脅對照表

| 威脅 | 防禦措施 |
|------|---------|
| MITM 竊取 | HTTPS + GCM 強制加密 |
| XSS 竊取 token | JWT 存 HttpOnly Cookie，JS 讀不到 |
| CSRF 偽造請求 | Cookie SameSite=Strict |
| Token 被偷後長期有效 | Access Token TTL 15 分鐘 |
| 強制登出 / 帳號停用 | Redis Blacklist 即時撤銷 |
| Refresh Token 被偷 | path="/auth/refresh" 限縮範圍 + TTL 7 天 |

### 7.3 Secret Manager（敏感資訊管理）

```bash
# 建立 secret
echo -n "值" | gcloud secrets create SECRET_NAME --data-file=-

# FastAPI 讀取
gcloud run services update SERVICE \
  --set-secrets ENV_VAR=SECRET_NAME:latest
```

| Secret 名稱 | 服務 | 用途 |
|------------|------|------|
| `AUTH_DATABASE_URL` | Auth Service | auth_db 連線字串 |
| `APP_DATABASE_URL` | Main Service | app_db 連線字串 |
| `REDIS_URL` | 兩者共用 | Redis 連線（`redis://redis:6379/0`）|
| `JWT_SECRET_KEY` | Auth Service | JWT 簽名金鑰（openssl rand -hex 32）|
| `LINE_CHANNEL_SECRET` | Auth + Main | LINE Webhook 驗證 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Main Service | LINE Push API |
| `GEMINI_API_KEY` | Main Service | Gemini API |
| `GCS_BUCKET_NAME` | Main Service | Cloud Storage bucket 名稱 |
| `GCP_PROJECT_ID` | 兩者共用 | GCP 專案 ID |

### 7.3 LIFF 設定

| 項目 | 值 |
|------|-----|
| LIFF URL | `https://liff.line.me/{LIFF_ID}` |
| Endpoint URL | `https://your-domain.com/liff` |
| Size | Full（全螢幕）|
| Scope | `profile openid` |

---

---

## 7A. Auth 微服務（Go）

### 7A.1 服務規格

| 項目 | 值 |
|------|-----|
| 語言 | Go 1.22+ |
| 框架 | `net/http` 標準庫 + `chi` router |
| 程序管理 | systemd（單 binary，冷啟動 < 50ms）|
| Port | 8001（Docker 內部網路，不對外）|
| Database | `auth_db`（同 Cloud SQL 實例）|
| 主要依賴 | `golang-jwt/jwt/v5`、`go-redis/v9`、`jackc/pgx/v5` |
| 記憶體用量 | ~15–25 MB（Python FastAPI 的 1/4）|
| 編譯產物 | 單一 binary，`go build -o auth_service` |

### 7A.2 專案結構

```
auth_service/
├── main.go                  # 入口，router 設定
├── config/
│   └── config.go            # 環境變數讀取
├── handler/
│   ├── verify.go            # GET  /auth/verify（Nginx sub_request）
│   ├── login.go             # POST /auth/line-token, /auth/google
│   ├── refresh.go           # POST /auth/refresh
│   ├── logout.go            # POST /auth/logout
│   └── health.go            # GET  /auth/health
├── engine/
│   ├── rbac.go              # RBAC：role → permissions 查詢
│   ├── pbac.go              # PBAC：policy condition 評估
│   └── engine.go            # Check()：RBAC + PBAC 組合判斷
├── model/
│   ├── user.go              # User、Role、Permission struct
│   └── policy.go            # Policy、PolicyCondition struct
├── store/
│   ├── db.go                # PostgreSQL 連線（pgx pool）
│   └── redis.go             # Redis 連線
├── token/
│   └── jwt.go               # JWT 發行 / 解析 / Blacklist
├── middleware/
│   └── logger.go            # 存取 log
└── Makefile                 # build / test / deploy 指令
```

### 7A.3 API 端點

| 端點 | 方法 | 說明 | 需要驗證 |
|------|------|------|---------|
| `/auth/line-token` | POST | LINE token 換 JWT，Set-Cookie | 否 |
| `/auth/google` | POST | Google OAuth 換 JWT，Set-Cookie | 否 |
| `/auth/refresh` | POST | Refresh Token 換新 Access Token | 否（帶 refresh cookie）|
| `/auth/logout` | POST | 撤銷 token，清除 cookie | 是 |
| `/auth/verify` | GET | Nginx sub_request 驗證 + RBAC/PBAC | 否（由此判斷）|
| `/auth/health` | GET | Health check | 否 |

### 7A.4 auth_db Schema（RBAC + PBAC）

```sql
-- ── 使用者 ───────────────────────────────────────
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    line_uuid     VARCHAR(64) UNIQUE,
    google_email  VARCHAR(100) UNIQUE,
    role_id       INT REFERENCES roles(id) NOT NULL,
    clinic_id     VARCHAR(20) NOT NULL,
    patient_id    INT,          -- role=patient 時對應 app_db.patients.id
    active        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_users_line_uuid    ON users(line_uuid);
CREATE INDEX idx_users_google_email ON users(google_email);

-- ── RBAC ─────────────────────────────────────────
CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL   -- patient/staff/nutritionist/admin
);

CREATE TABLE permissions (
    id       SERIAL PRIMARY KEY,
    name     VARCHAR(100) UNIQUE NOT NULL,    -- inbody:read、visit:write ...
    resource VARCHAR(50)  NOT NULL,           -- inbody、visit、food_log ...
    action   VARCHAR(20)  NOT NULL            -- read、write、delete、send
);

CREATE TABLE role_permissions (
    role_id       INT REFERENCES roles(id),
    permission_id INT REFERENCES permissions(id),
    PRIMARY KEY (role_id, permission_id)
);

-- ── PBAC ─────────────────────────────────────────
CREATE TABLE policies (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(100) UNIQUE NOT NULL,
    effect VARCHAR(10) DEFAULT 'allow'        -- allow / deny
);

CREATE TABLE policy_conditions (
    id             SERIAL PRIMARY KEY,
    policy_id      INT REFERENCES policies(id),
    condition_type VARCHAR(30) NOT NULL,
    -- resource_owner：subject.patient_id = resource.patient_id
    -- clinic_scope  ：subject.clinic_id  = resource.clinic_id
    -- time_window   ：NOW() BETWEEN start AND end
    operator       VARCHAR(20) NOT NULL,      -- eq / between
    value_config   JSONB NOT NULL
    -- time_window: {"start":"08:00","end":"20:00","tz":"Asia/Taipei"}
);

CREATE TABLE permission_policies (
    permission_id INT REFERENCES permissions(id),
    policy_id     INT REFERENCES policies(id),
    PRIMARY KEY (permission_id, policy_id)
);

-- ── 稽核 ─────────────────────────────────────────
CREATE TABLE login_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id),
    login_at   TIMESTAMP DEFAULT NOW(),
    ip         VARCHAR(45),
    user_agent TEXT
);
```

### 7A.5 核心實作（Go）

#### token/jwt.go

```go
package token

import (
    "context"
    "fmt"
    "time"

    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
)

type Claims struct {
    UserID    int    `json:"user_id"`
    Role      string `json:"role"`
    ClinicID  string `json:"clinic_id"`
    PatientID int    `json:"patient_id,omitempty"`
    TokenType string `json:"type"`  // access / refresh
    jwt.RegisteredClaims
}

func Issue(userID int, role, clinicID string, patientID int,
    tokenType string, ttl time.Duration, secret string) (string, error) {

    claims := Claims{
        UserID:    userID,
        Role:      role,
        ClinicID:  clinicID,
        PatientID: patientID,
        TokenType: tokenType,
        RegisteredClaims: jwt.RegisteredClaims{
            ID:        uuid.New().String(),   // jti
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
        },
    }
    return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
        SignedString([]byte(secret))
}

func Parse(tokenStr, secret string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenStr, &Claims{},
        func(t *jwt.Token) (any, error) {
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method")
            }
            return []byte(secret), nil
        })
    if err != nil || !token.Valid {
        return nil, fmt.Errorf("invalid token")
    }
    return token.Claims.(*Claims), nil
}

func Revoke(ctx context.Context, rdb *redis.Client, jti string, exp time.Time) error {
    ttl := time.Until(exp)
    if ttl <= 0 {
        return nil
    }
    return rdb.SetEx(ctx, "auth:blacklist:"+jti, "1", ttl).Err()
}

func IsRevoked(ctx context.Context, rdb *redis.Client, jti string) (bool, error) {
    n, err := rdb.Exists(ctx, "auth:blacklist:"+jti).Result()
    return n > 0, err
}
```

#### engine/engine.go

```go
package engine

import (
    "context"
    "fmt"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

type Subject struct {
    UserID    int
    Role      string
    ClinicID  string
    PatientID int
}

type Resource struct {
    ClinicID  string
    PatientID int   // 0 表示非病患資源
}

// Check 執行 RBAC + PBAC，回傳是否允許
func Check(ctx context.Context, db *pgxpool.Pool,
    sub Subject, permission string, res Resource) (bool, error) {

    // ── Step 1：RBAC ──
    var hasPerm bool
    err := db.QueryRow(ctx, `
        SELECT EXISTS (
            SELECT 1
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            JOIN roles r       ON rp.role_id = r.id
            WHERE r.name = $1 AND p.name = $2
        )`, sub.Role, permission).Scan(&hasPerm)
    if err != nil || !hasPerm {
        return false, err
    }

    // ── Step 2：PBAC ──
    rows, err := db.Query(ctx, `
        SELECT pc.condition_type, pc.operator, pc.value_config
        FROM permission_policies pp
        JOIN policies pol          ON pp.policy_id     = pol.id
        JOIN policy_conditions pc  ON pc.policy_id     = pol.id
        WHERE pp.permission_id = (
            SELECT id FROM permissions WHERE name = $1
        )`, permission)
    if err != nil {
        return false, err
    }
    defer rows.Close()

    for rows.Next() {
        var condType, op string
        var cfg map[string]string
        if err := rows.Scan(&condType, &op, &cfg); err != nil {
            return false, err
        }
        if !evaluate(condType, cfg, sub, res) {
            return false, nil   // 任一 policy 不過 → 拒絕
        }
    }
    return true, nil
}

func evaluate(condType string, cfg map[string]string,
    sub Subject, res Resource) bool {

    switch condType {
    case "resource_owner":
        // 病患只能存取自己的資源
        return res.PatientID == 0 || sub.PatientID == res.PatientID

    case "clinic_scope":
        // 只能存取同診所資源
        return sub.ClinicID == res.ClinicID

    case "time_window":
        tz, _ := time.LoadLocation(cfg["tz"])
        now   := time.Now().In(tz)
        start, _ := time.ParseInLocation("15:04", cfg["start"], tz)
        end,   _ := time.ParseInLocation("15:04", cfg["end"],   tz)
        // 只比較時分
        nowMin   := now.Hour()*60 + now.Minute()
        startMin := start.Hour()*60 + start.Minute()
        endMin   := end.Hour()*60 + end.Minute()
        return nowMin >= startMin && nowMin <= endMin
    }
    return true
}
```

#### handler/verify.go

```go
package handler

import (
    "net/http"
    "strconv"
    "strings"

    "auth_service/engine"
    "auth_service/token"
)

// permissionMap：(method, uri prefix) → permission name
var permissionMap = map[[2]string]string{
    {"GET",   "/inbody"}:        "inbody:read",
    {"POST",  "/inbody"}:        "inbody:write",
    {"GET",   "/food-logs"}:     "food_log:read",
    {"POST",  "/food-logs"}:     "food_log:write",
    {"GET",   "/visits"}:        "visit:read",
    {"POST",  "/visits"}:        "visit:write",
    {"GET",   "/notifications"}: "notification:read",
    {"PATCH", "/notifications"}: "notification:write",
    {"POST",  "/notify"}:        "push:send",
    {"GET",   "/patients"}:      "patient:manage",
}

func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
    // 1. 取 cookie
    cookie, err := r.Cookie("access_token")
    if err != nil {
        http.Error(w, "no token", http.StatusUnauthorized)
        return
    }

    // 2. 解析 JWT
    claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret)
    if err != nil {
        http.Error(w, "invalid token", http.StatusUnauthorized)
        return
    }

    // 3. 查 blacklist
    revoked, _ := token.IsRevoked(r.Context(), h.rdb, claims.ID)
    if revoked {
        http.Error(w, "token revoked", http.StatusUnauthorized)
        return
    }

    // 4. 解析原始請求的 method + URI
    method := r.Header.Get("X-Original-Method")
    uri    := r.Header.Get("X-Original-URI")
    perm   := resolvePermission(method, uri)

    // 5. RBAC + PBAC
    if perm != "" {
        sub := engine.Subject{
            UserID:    claims.UserID,
            Role:      claims.Role,
            ClinicID:  claims.ClinicID,
            PatientID: claims.PatientID,
        }
        res := resolveResource(uri, sub)   // 從 URI 取得資源 context

        allowed, err := engine.Check(r.Context(), h.db, sub, perm, res)
        if err != nil || !allowed {
            http.Error(w, "permission denied", http.StatusForbidden)
            return
        }
    }

    // 6. 通過，注入 header
    w.Header().Set("X-User-Id",    strconv.Itoa(claims.UserID))
    w.Header().Set("X-User-Role",  claims.Role)
    w.Header().Set("X-Clinic-Id",  claims.ClinicID)
    w.Header().Set("X-Patient-Id", strconv.Itoa(claims.PatientID))
    w.WriteHeader(http.StatusOK)
}

func resolvePermission(method, uri string) string {
    for prefix, perm := range permissionMap {
        if prefix[0] == method && strings.HasPrefix(uri, "/api"+prefix[1]) {
            return perm
        }
    }
    return ""
}

func resolveResource(uri string, sub engine.Subject) engine.Resource {
    // /api/inbody, /api/food-logs 等病患資源
    // 預設 clinic_id 同 subject，patient_id 從 URI param 取
    // 若為 /api/patients（管理員操作）patient_id = 0
    res := engine.Resource{ClinicID: sub.ClinicID}
    if strings.Contains(uri, "/patients/") {
        // e.g. /api/patients/17/inbody → patient_id = 17
        parts := strings.Split(uri, "/")
        for i, p := range parts {
            if p == "patients" && i+1 < len(parts) {
                res.PatientID, _ = strconv.Atoi(parts[i+1])
            }
        }
    } else {
        res.PatientID = sub.PatientID
    }
    return res
}
```

#### main.go

```go
package main

import (
    "log"
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"

    "auth_service/config"
    "auth_service/handler"
    "auth_service/store"
)

func main() {
    cfg := config.Load()
    db  := store.NewDB(cfg.AuthDatabaseURL)
    rdb := store.NewRedis(cfg.RedisURL)
    h   := handler.New(cfg, db, rdb)

    r := chi.NewRouter()
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)

    r.Get("/auth/verify",       h.Verify)    // Nginx sub_request
    r.Post("/auth/line-token",  h.LineLogin)
    r.Post("/auth/google",      h.GoogleLogin)
    r.Post("/auth/refresh",     h.Refresh)
    r.Post("/auth/logout",      h.Logout)
    r.Get("/auth/health",       h.Health)

    log.Println("auth service listening on :8001")
    log.Fatal(http.ListenAndServe(":8001", r))
}
```

#### go.mod（主要依賴）

```
module auth_service

go 1.22

require (
    github.com/go-chi/chi/v5        v5.0.12
    github.com/golang-jwt/jwt/v5    v5.2.1
    github.com/google/uuid          v1.6.0
    github.com/jackc/pgx/v5         v5.5.5
    github.com/redis/go-redis/v9    v9.5.1
)
```

### 7A.6 Dockerfile（Auth Service）

```dockerfile
# auth_service/Dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o auth_service .

FROM alpine:3.19
RUN apk add --no-cache tzdata ca-certificates
WORKDIR /app
COPY --from=builder /app/auth_service .
EXPOSE 8001
CMD ["./auth_service"]
```

> multi-stage build，最終 image 約 15–20 MB。

### 7A.7 Main Service 的改動（Python FastAPI，不變）

主服務完全不處理 JWT 和 permission，直接讀 Nginx 注入的 header：

```python
# main_service/deps.py
from fastapi import Header

async def current_user(
    x_user_id:    str = Header(...),
    x_user_role:  str = Header(...),
    x_clinic_id:  str = Header(...),
    x_patient_id: str = Header(default=""),
):
    return {
        "user_id":    int(x_user_id),
        "role":       x_user_role,
        "clinic_id":  x_clinic_id,
        "patient_id": int(x_patient_id) if x_patient_id else None,
    }

# API 不寫任何 role / permission 判斷
@app.get("/inbody/history")
async def inbody_history(user=Depends(current_user), db=Depends(get_db)):
    # Auth Service 已確保：有 inbody:read 權限 + 只能看自己的
    return await db.fetch_inbody(user["patient_id"])
```


## 8. 環境變數清單

```bash
# auth_service/.env（Auth 微服務 - Go）
AUTH_DATABASE_URL=postgres://user:pass@/auth_db?host=/cloudsql/PROJECT:REGION:INSTANCE
REDIS_URL=redis://redis:6379/0
JWT_SECRET_KEY=                    # openssl rand -hex 32
ACCESS_TOKEN_EXPIRE=900            # 15 分鐘（秒）
REFRESH_TOKEN_EXPIRE=604800        # 7 天（秒）
LINE_CHANNEL_SECRET=
GOOGLE_CLIENT_ID=                  # 醫護人員 Google OAuth
GOOGLE_CLIENT_SECRET=
ENV=production
```

```bash
# main_service/.env（主業務服務）
APP_DATABASE_URL=postgresql+asyncpg://user:pass@/app_db?host=/cloudsql/PROJECT:REGION:INSTANCE
REDIS_URL=redis://redis:6379/0
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=
GEMINI_API_KEY=
GCS_BUCKET_NAME=
GCP_PROJECT_ID=
ENVIRONMENT=production
```

---

## 9. 開發環境建置

### 9.1 前置需求

```bash
# 本機需要安裝
docker          >= 24（含 Docker Compose v2）
go              >= 1.22（auth_service 本機開發用）
node            >= 20（frontend 本機開發用）
python          >= 3.11（main_service 本機開發用）
gcloud          # GCP CLI
```

### 9.2 本機開發（docker compose）

```bash
# 複製環境變數範本
cp .env.example .env
# 編輯 .env 填入 LINE / Gemini / GCS 的 key

# 啟動所有服務（含 PostgreSQL + Redis）
docker compose -f docker-compose.dev.yml up

# 只啟動基礎設施（DB + Redis），服務本機跑
docker compose -f docker-compose.dev.yml up postgres redis

# 看 log
docker compose logs -f auth_service
docker compose logs -f main_service
```

### 9.3 各服務本機開發模式

```bash
# Auth Service（Go）
cd auth_service
go run .            # 熱重載用 air：air -c .air.toml

# Main Service（Python）
cd main_service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend（Next.js）
cd frontend
pnpm install
pnpm dev            # LIFF 測試需要 HTTPS → ngrok http 3000
```

### 9.4 本機 .env 範例

```bash
# .env（根目錄，docker compose 共用）
POSTGRES_PASSWORD=dev

# auth_service
AUTH_DATABASE_URL=postgres://postgres:dev@postgres:5432/auth_db
REDIS_URL=redis://redis:6379/0
JWT_SECRET_KEY=dev-jwt-secret-change-in-production
ACCESS_TOKEN_EXPIRE=900
REFRESH_TOKEN_EXPIRE=604800
LINE_CHANNEL_SECRET=（測試用）
GOOGLE_CLIENT_ID=（測試用）
GOOGLE_CLIENT_SECRET=（測試用）

# main_service
APP_DATABASE_URL=postgresql+asyncpg://postgres:dev@postgres:5432/app_db
LINE_CHANNEL_ACCESS_TOKEN=（測試用）
LIFF_ID=（測試用）
GEMINI_API_KEY=（測試用）
GCS_BUCKET_NAME=（測試用）
GCP_PROJECT_ID=（測試用）
```

---

## 10. 部署流程

### 10.1 docker-compose.yml（正式環境）

```yaml
# docker-compose.yml
services:

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - auth_service
      - main_service
      - frontend
    restart: always

  auth_service:
    build:
      context: ./auth_service
      dockerfile: Dockerfile
    expose:
      - "8001"
    env_file: ./auth_service/.env
    depends_on:
      - redis
      - cloudsql_proxy
    restart: always

  main_service:
    build:
      context: ./main_service
      dockerfile: Dockerfile
    expose:
      - "8000"
    env_file: ./main_service/.env
    depends_on:
      - redis
      - cloudsql_proxy
    restart: always

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    expose:
      - "3000"
    env_file: ./frontend/.env
    restart: always

  redis:
    image: redis:7-alpine
    expose:
      - "6379"
    volumes:
      - redis_data:/data
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    restart: always

  cloudsql_proxy:
    image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
    command:
      - "--address=0.0.0.0"
      - "--port=5432"
      - "PROJECT:asia-east1:INSTANCE"
    volumes:
      - ./credentials/service-account.json:/secrets/sa.json:ro
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json
    expose:
      - "5432"
    restart: always

volumes:
  redis_data:
```

### 10.2 docker-compose.dev.yml（本機開發）

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: dev
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pg_data:
```

### 10.3 CI/CD（GitHub Actions）

```yaml
# .github/workflows/deploy.yml
name: Deploy to VM

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VM_IP }}
          username: ubuntu
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /home/ubuntu/app
            git pull origin main

            # 重新 build 並滾動更新（不停機）
            docker compose build
            docker compose up -d --no-deps --build auth_service
            docker compose up -d --no-deps --build main_service
            docker compose up -d --no-deps --build frontend
            docker compose up -d nginx

            # 清除舊 image
            docker image prune -f
```

### 10.4 首次部署 Checklist

```
□ GCP 專案建立，billing 帳戶設定
□ Cloud SQL 實例建立，備份設定完成
□ Cloud Storage bucket 建立，權限設定
□ VM 建立，安裝 Docker + Docker Compose v2
□ VM 上 clone repo，複製 .env 並填入所有 secret
□ Service Account 金鑰下載，放至 credentials/service-account.json
□ docker compose up -d 啟動所有服務
□ Cloud Load Balancer 建立，Health Check 設定（/api/health）
□ GCM 憑證申請（DNS 需先指向 LB IP）
□ Cloudflare DNS A record 指向 LB 靜態 IP
□ LINE Developers Console：Webhook URL 設定
□ LINE Developers Console：LIFF Endpoint URL 設定
□ Cloud Scheduler job 建立
□ GitHub Actions Secrets 設定（VM_IP / SSH_PRIVATE_KEY）
□ 執行端對端測試（LIFF 綁定 → InBody 上傳 → 推播）
```

### 10.5 Rollback

```bash
# 回到上一個 image（docker compose 內建版本）
docker compose up -d --no-deps auth_service  # 重新 pull 上一版

# 或指定 git commit 重新 build
git checkout <commit-hash>
docker compose build && docker compose up -d
```

---

## 11. 高可用方案（HA）對照

> 當需要從標準方案升級到 HA 方案時，以下是差異對照

| 項目 | 標準方案 | HA 方案 |
|------|---------|---------|
| VM 數量 | 1 台（asia-east1-b）| 2 台（asia-east1-b + c）|
| Redis | VM 自架（127.0.0.1）| GCP Memorystore 1GB |
| Cloud SQL | 單機 | Regional HA（主 + 備，不同 zone）|
| 月費（成長期）| NT$4,708 | NT$8,514 |
| VM 故障恢復 | 人工 ~30 分鐘 | 自動 ~30 秒 |
| DB 故障恢復 | 人工 ~60 分鐘 | 自動 ~60 秒 |

**HA 升級步驟**

```bash
# 1. Cloud SQL 升級為 Regional HA
gcloud sql instances patch INSTANCE \
  --availability-type=REGIONAL

# 2. 建立第二台 VM（同樣的設定，不同 zone）
gcloud compute instances create vm-2 \
  --machine-type=e2-standard-2 \
  --zone=asia-east1-c \
  ...

# 3. 建立 Instance Group，加入兩台 VM
gcloud compute instance-groups unmanaged create ig-app \
  --zone=asia-east1-b
gcloud compute instance-groups unmanaged add-instances ig-app \
  --instances=vm-1,vm-2

# 4. LB Backend 改指向 Instance Group

# 5. Redis 改用 Memorystore
gcloud redis instances create redis-main \
  --size=1 \
  --region=asia-east1 \
  --tier=BASIC
# 更新 REDIS_URL 為 Memorystore IP
```

---

## 12. 三個服務開發過程重點

> 實作位置：`bye-weight/`（`auth_service/`、`main_service/`、`frontend/`）

### 12.1 auth_service（Go + chi，已完成）

- **進入點** `main.go` 註冊 chi router，啟動時自動跑 migration，並啟動 RBAC/PBAC policy 5 分鐘快取刷新迴圈。
- **授權引擎** `engine/engine.go` 實作 RBAC + PBAC 雙層：先查 role_permissions，再逐一評估 policy_conditions（`resource_owner` / `clinic_scope` / `time_window`）。
- **JWT 流程** `token/jwt.go` 用 HMAC-SHA256 簽發 access（15 分鐘）/ refresh（7 天），`jti` 寫入 Redis blacklist 支援即時撤銷。
- **Handler 群組** `handler/` 拆分 verify / login（LINE + Google OAuth）/ refresh / logout / health；`verify.go` 對應 Nginx `auth_request`，通過後回寫 `X-User-Id / X-User-Role / X-Clinic-Id / X-Patient-Id`。
- **Schema migrations** `migrations/000001` 建立 users / roles / permissions / policies / policy_conditions / login_logs；`000002` seed 4 個角色（patient/staff/nutritionist/admin）+ 11 個 permission，patient 預綁 `resource_owner` policy。
- **主要依賴** chi v5、golang-jwt v5、pgx v5、go-redis v9；multi-stage Dockerfile，最終 image ~15–20 MB。

### 12.2 main_service（Python FastAPI，約 70%）

- **入口** `main.py` 掛載 8 個 router：health / patients / inbody / food_logs / visits / notifications / line_webhook / upload。
- **非同步資料層** `database.py` 用 SQLAlchemy 2.0 + asyncpg（pool_size=10），Alembic `0001_init_schema` 一次建齊 9 張業務表。
- **認證解耦** `deps.py` 僅從 `X-User-*` header 取上下文，JWT / RBAC / PBAC 完全交給 auth_service，路由層不寫權限判斷。
- **Models** patient / line_binding / employee / visit / medication / inbody / inbody_pending / food_log（JSONB）/ notification_rule / notification_log。
- **已實作路由** food_logs（日期範圍 + 寫入時自動 `cache:food:*` invalidate）、inbody（上傳 + OCR pending 比對）、patients（GET + LINE 綁定）、visits（CRUD）。
- **外部整合** `services/ocr.py`（Gemini 2.5 Flash 影像辨識骨架）、`services/matching.py`（姓名 + 生日雙欄位 patient 比對，ambiguous 寫入 inbody_pending）、`services/notification.py`（LINE Push 骨架）。
- **待補** LINE webhook 事件分派、AI 飲食建議、notification 排程觸發邏輯仍為 stub。

### 12.3 frontend（Next.js 14 App Router，約 60%）

- **App Router 分域** `src/app/` 依角色切四塊：`patient/` / `staff/` / `nutritionist/` / `admin/`，另有 `liff/` 處理 LINE LIFF 登入導流。
- **API 層** `lib/api.ts` 封裝 `fetchAPI`，自動帶 cookie、401 時呼叫 `/auth/refresh` 重試，仍失敗再導回 LIFF 重登。
- **Auth 橋接** `lib/auth.ts` 初始化 LIFF → `liff.getAccessToken()` → POST `/auth/line-token` 換 HttpOnly cookie，前端完全讀不到 JWT。
- **已拉頁面** `/patient/inbody`（Recharts 趨勢）、`/patient/food-logs`（營養素 grid）、`/patient/visits`、`/patient/notifications`、`/staff/inbody`（上傳）、`/nutritionist/push`、`/admin/patients`。
- **技術棧** Next.js 14.2（standalone output 便於 Docker）、React 18.3、TypeScript 5.4、Tailwind 3.4、LINE LIFF 2.24、Recharts 2.12。
- **待補** 表單互動、圖片上傳 presigned URL 串接、推播排程 UI 多為骨架。

### 12.4 服務整合要點

- **Nginx** 以 `auth_request = /auth/verify` 統一攔截 `/api/*`；`/api/line/webhook` 例外（改用 LINE signature 驗證）。
- **雙資料庫** `auth_db`（權限）與 `app_db`（業務）共用同一 Cloud SQL 實例但不跨庫 FK，使用者身份以 header 傳遞。
- **Docker Compose** `docker-compose.yml` 走 Cloud SQL Proxy；`docker-compose.dev.yml` 僅起 postgres + redis，三個服務可本機 hot-reload 或全容器啟動。
- **快取命名** auth 用 `auth:blacklist:*`；main 用 `cache:{resource}:*`，由寫入端主動 invalidate。

