# LINE OA → InBody 自動攝取流程

## TL;DR

員工（`staff` / `nutritionist` / `admin`）在 LINE OA 聊天室傳一張 InBody 體組成報告照片 → 系統自動辨識內容（姓名、生日、體重、BMI、體脂、肌肉量、內臟脂肪、基礎代謝率）→ 以「姓名 + 生日」比對同 tenant 病患 → 寫入 `inbody_records`；找不到或多筆同名則寫 `inbody_pending` 等人工確認 → 病患在 LIFF `/patient/inbody` 自動看到新紀錄。

## 流程圖

```
員工 LINE OA 傳 InBody 照片
            │
            ▼
POST /api/v1/line/webhook     ← nginx location /api/v1/line/webhook（繞過 auth_request）
            │
            │   verify_line_signature(body, X-Line-Signature)
            │   json.loads(body) → { events: [...] }
            │
            ▼
_handle_event(event)
  │
  │  event.type != "message" or message.type != "image" or source.type != "user"
  │   → 靜默 no-op（follow/unfollow/text 等暫不處理）
  │
  ▼
resolve_sender(event.source.userId)         ← httpx → auth_service /auth/internal/users/by-line-uuid
  │
  │  None（找不到 / 非 active / 軟刪）
  │   → reply「尚未綁定本系統」
  │
  │  role ∉ {staff, nutritionist, admin}
  │   → reply「您的角色無權上傳」
  │
  ▼
download_content(event.message.id)          ← GET api-data.line.me/v2/bot/message/{id}/content
  │
  │  HTTP 錯誤 → reply「取得圖片失敗」+ log
  │
  ▼
async with session_context(tenant, user) as db:  ← app_db 連線 + SET LOCAL RLS / audit
    ingest_inbody(db, uploader_uid, tenant_id, image_bytes, image_url)
      │
      ├─ ocr_inbody(bytes) → Gemini 2.5 Flash → {name, birth_date, weight, bmi, ...}
      │      └ exception → inbody_pending(status=ocr_failed)
      │
      ├─ match_patient(name, birth_date, tenant_id)
      │      ├─ matched   → inbody_records INSERT + invalidate cache:inbody:{pid}
      │      ├─ ambiguous → inbody_pending INSERT（多位同名需人工）
      │      └─ unmatched → inbody_pending INSERT（診所查無此人）
      │
      ▼
reply_message(event.replyToken, [依 status 組的繁中訊息])
```

## 回給員工的訊息模板

| status | 員工看到 |
|---|---|
| `matched` | ✅ 已為 {name} 記錄 InBody 資料，病患可在 LIFF 查看。 |
| `ambiguous` | ⚠️ 找到 {N} 位同名病患，請至後台人工確認歸屬。 |
| `unmatched` | ⚠️ 在您的診所查無病患「{ocr_name}」，已進入待確認清單。 |
| `ocr_failed` | ❌ 無法辨識圖片內容，請確認照片清晰、是否為 InBody 報告。 |
| sender 角色不符 | ❌ 您的角色（xxx）無權上傳 InBody 報告。 |
| sender 未綁定 | ❌ 您的 LINE 尚未綁定本系統，請向診所索取綁定連結。 |

## 病患端看到什麼

現有 `GET /api/v1/inbody/history`（`routers/inbody.py`）＋ `/patient/inbody` LIFF 頁本來就存在。ingest 寫入 `inbody_records` 後，病患下次開 LIFF 或重新整理該頁就看到新紀錄。**前端不用改**。

## 檔案對照

| 檔 | 責任 |
|---|---|
| `routers/line_webhook.py` | HTTP 入口、signature 驗證、event dispatch、格式化回覆 |
| `services/line_sender.py` | LINE UUID → 呼叫 auth_service `/auth/internal/users/by-line-uuid` 反查 role + tenant |
| `auth_service/handler/huma_internal.go` | Internal endpoint 本體；shared secret 驗 header，查 DB 回 {user_id, role, tenant_id, display_name} |
| `services/inbody_ingest.py` | OCR + matching + 寫入 inbody_records / inbody_pending 的共用邏輯 |
| `services/ocr.py` | Gemini 2.5 Flash 呼叫；`ocr_inbody(bytes) → dict` |
| `services/matching.py` | 姓名 + 生日 patient 比對，限 tenant |
| `utils/line.py` | `verify_line_signature` / `download_content` / `reply_message` / `text_message` / `push_message` |
| `database.py` | `session_context(tenant, user)` 非 HTTP 入口用的 session opener（觸發 RLS + audit） |
| `tests/test_line_inbody.py` | webhook dispatch 的 7 個 mock-based case |

## 設計決策（為什麼這樣做）

1. **透過 auth_service internal endpoint，不直連 auth_db**：users / roles 的擁有者是 auth_service，跨服務 SQL 會繞掉業務規則（active、軟刪）與稽核，且 schema 改動會靜默壞掉其他 service。HTTP 成本 1–2ms 換來清楚的 service boundary。保護方式：`X-Internal-Token` shared secret，fail-close（token 空 → 一律 401）。之後要加 mTLS / OIDC 都是在同一道門加鎖。
2. **非 HTTP 入口用 `session_context` 而非 `get_db`**：`get_db` 讀 X-Tenant-Id header，webhook 沒有這顆 header；改用 explicit tenant/user_id 參數包 ContextVar，維持 RLS + audit trigger 行為一致。
3. **Reply 而非 Push**：webhook reply_token 30 秒內可用、不消耗 push 額度，適合即時回覆。錯過 30 秒的情境（超長 OCR）現在罕見；真的遇到再 fallback push。
4. **同名多筆 → pending，不猜**：臨床上弄錯病患的 InBody 是安全事件，寧可卡住等確認也不要自動歸錯人。
5. **Webhook 一律回 200**：LINE 對非 2xx 會重送，但我們已 `commit` OCR 結果了，重送浪費 Gemini 配額。失敗情境寫 `inbody_pending(status=ocr_failed)` + log.exception。
6. **signature 驗證 fail-closed**：`LINE_CHANNEL_SECRET` 空字串時 `verify_line_signature` 一律回 False，避免 dev 環境誤放行。
7. **images only**：目前不處理 video / audio / text；語意不 match InBody 流程。未來擴「食物照片 → food_log」共用同一個 dispatcher 骨架。

## 目前不做（待後續）

- **幂等性**：LINE 網路重送同一 message_id 會走第二輪 OCR。需要時加 `(tenant, message_id)` unique index 或 Redis `seen:line-msg:{id}` TTL key。
- **多 OA / 多 tenant 隔離**：現在假設一個 LINE OA 服務所有 tenant；如果每個診所一個 OA，每家 `LINE_CHANNEL_SECRET / ACCESS_TOKEN` 不同，需要改成 per-tenant secret 查表。
- **admin 後台手動上傳 fallback**：webhook 掛掉時員工要能補傳。之後加 `POST /api/v1/inbody` 吃 `UploadFile`，共用 `ingest_inbody()`。
- **ambiguous / unmatched 的人工處理 UI**：`inbody_pending` 現在沒有 admin 後台介面；之後加一個 `/admin/inbody-pending` 頁讓 clinic-admin 手動指派。

## 開發 / 驗證

```bash
# 跑測試
docker compose -f docker-compose.dev.yml exec main_service pytest tests/test_line_inbody.py -v
```
