# Kuji 後端資料流

> 說明 Kuji 從「使用者建立會議」到「任務自動路由到外部系統」整條 pipeline 的 DB entities、status 生命週期、以及 AI 服務要在哪裡介入。
>
> 涵蓋：**已實作** + **Phase 2+ AI pipeline 規畫**。

---

## 1. 名詞釐清（同義反覆）

| UI 文字 | 資料層 | 備註 |
|---|---|---|
| **行動事項** / Action Items / Action Board | `tasks` 表 | Sidebar / 主看板稱「行動事項」屬宣傳語 |
| **任務** / Task | `tasks` 表 | 同一個東西；短 tech term |
| **錄音片段** / source clip / related clip | `task_clips` 表 | 每個 task 由 AI 挑 1 primary + 0–2 related |
| **逐字稿** / transcript / 段落 | `transcript_segments` 表 | ASR 輸出的時間戳化文字 |
| **會議** / meeting | `meetings` 表 | 錄音的容器 |

**結論**：行動事項 = 任務 = `tasks` 表。一個會議可以產生 0~N 個 task。

---

## 2. Entity 關聯圖

```
                    ┌──────────────────┐
                    │    meetings      │
                    │  id, tenant_id   │
                    │  title           │
                    │  status ← ── ── ──┼── recording / processing / done
                    │  source          │   ← record / upload / zoom / teams / meet
                    │  audio_url       │   ← GCS blob / local demo file
                    │  duration_sec    │
                    │  summary         │   ← LLM 產出的 TL;DR
                    └────┬─────────────┘
                         │ 1 : N
                         ▼
              ┌───────────────────────────┐
              │   transcript_segments     │
              │   id, meeting_id          │
              │   speaker_id, name        │   ← ASR diarization
              │   start_ms, end_ms        │
              │   text                    │
              │   highlight               │   ← task / decision / question / null
              └────┬──────────────────────┘
                   │ N : N（透過 task_clips）
                   ▼
        ┌──────────────────────────────┐   ┌───────────────────────┐
        │         task_clips           │   │       tasks           │
        │  id, task_id, segment_id     │   │  id, tenant_id        │
        │  role          primary/relat │   │  title                │
        │  rank          0..2          │   │  status  todo/doing/done │
        │  ai_confidence               │◀──│  owner_user_id        │
        │  note          LLM 抽片理由  │   │  owner_name (snapshot)│
        └──────────────────────────────┘   │  due_at / due_label   │
                                           │  tag   → 整合路由鍵   │
                                           │  priority             │
                                           │  source_quote         │
                                           │  source_segment_id    │← 主片段快捷 FK
                                           │  ai_confidence        │← 主片段 confidence
                                           └──────────┬────────────┘
                                                      │
                                                      │ tag == 'slack'|'notion'|'gcal'...
                                                      ▼
                                         ┌───────────────────────────┐
                                         │      integrations         │
                                         │  tenant_id, kind          │
                                         │  connected                │
                                         │  oauth_access_token       │← AES/KMS 加密
                                         │  oauth_refresh_token      │
                                         │  config        JSONB      │
                                         │      notion: database_id  │
                                         │      slack: channel       │
                                         │      gcal: calendar_id    │
                                         └───────────────────────────┘
```

其他獨立表：
- `integration_providers` — 靜態 provider spec（fields schema）
- `integration_oauth_states` — OAuth 授權的短期 state
- `team_members` — tenant 成員 + aliases（幫 LLM 對齊 `speaker_name → owner_user_id`）

---

## 3. Meeting status 生命週期

```
              user picks “Record live”                user picks “Upload file”
                      │                                        │
                      ▼                                        ▼
              ┌───────────────┐                        ┌──────────────┐
              │  recording    │  ← 瀏覽器正在錄音        │   (no state) │
              │               │  (streaming to server)  │  pending       │
              └───────┬───────┘                        └──────┬───────┘
                      │ user presses Stop                      │ file uploaded to GCS
                      ▼                                        ▼
              ┌───────────────────────────────────────────────────┐
              │              processing                           │  ← ASR / LLM 處理中
              │  * audio_url 已指向 GCS / demo file              │     meetings.status='processing'
              │  * transcript_segments 寫入中                     │
              │  * tasks 抽取中                                  │
              │  * task_clips 打分數 / 選片段中                   │
              └───────┬───────────────────────────────────────────┘
                      │  AI pipeline 完成 → commit tx
                      ▼
              ┌───────────────┐
              │     done      │  ← 可看 transcript、tasks、clips；可編輯、可導到整合
              │               │
              └───────────────┘
```

轉狀態由 **kuji_backend** 決定（不是 AI 服務直接改 DB）：AI 服務 job 完成後 callback Kuji 的 webhook，Kuji 端在同一個 DB tx 裡寫 segments + tasks + clips + flip meeting.status='done'。

---

## 4. 完整 pipeline：從使用者開錄音到任務同步 Slack

### Phase 1 · 使用者觸發（已實作 UI、backend 建 row）

```
                                        ┌── User: /kuji/meetings + [+ New meeting]
                                        │       ↓ 選 Record live / Upload audio
                                        ▼
[Kuji Frontend]                         POST /kuji/api/v1/meetings
                                        body: { title, source: "record"|"upload" }
                                              ↓
[kuji_backend meetings.py]              ─▶ INSERT INTO meetings
                                           (tenant_id, title, source, status='recording',
                                            scheduled_at=NOW(), speaker_count=0)
                                        201 { id, title, status, ... }
```

### Phase 2 · 音檔落地（尚未實作）

兩種來源：

**2a · 即時錄音**
```
Browser MediaRecorder          →   WebSocket chunks    →  kuji_backend stream endpoint
                                                           → GCS resumable upload
Stop button                    →   POST /meetings/{id}/finalize
                                                           → UPDATE meetings SET
                                                               audio_url = 'gs://...',
                                                               ended_at = NOW(),
                                                               duration_sec = ...,
                                                               status = 'processing'
```

**2b · 檔案上傳**
```
Browser drag/drop              →   前端拿 GCS signed upload URL
                                                → PUT 直傳 GCS（避開後端流量）
                                                → PATCH /meetings/{id} { audio_url, status:'processing' }
```

兩條路都收斂到同一個狀態：`meetings.audio_url` 有值、`status='processing'`。

### Phase 3 · AI pipeline（尚未實作；目前 transcript / task 由 seed 直接塞）

實作起來是一條非同步 pipeline，建議用 Cloud Tasks / Pub/Sub 觸發：

```
meetings.status='processing' 事件
            │
            ▼
[ASR 服務 · Whisper / Gemini Audio / Google STT]
    input : GCS audio URL
    output: [{speaker, start_ms, end_ms, text}, ...]
            │
            ▼ (webhook / job callback)
[kuji_backend asr_callback endpoint]
    ─▶ INSERT INTO transcript_segments
       (meeting_id, speaker_id, speaker_name, start_ms, end_ms, text)
    ─▶ enqueue LLM extraction job
            │
            ▼
[LLM 服務 · Gemini 2.5 Pro / Claude Sonnet]
    input : 完整 transcript + team_members.aliases 映射表
    prompt: "挑出 action items，每條給：title / owner / due / tag / priority /
             primary clip (segment_id, confidence, reason) /
             0..2 related clips (segment_id, confidence, reason) /
             summary"
    output: {
      summary: "...",
      tasks: [
        {
          title, owner_alias_matched_to_user_id, due_label, tag, priority,
          source_quote, ai_confidence,
          primary_clip: {segment_id, confidence, note},
          related_clips: [{segment_id, confidence, note}, ...]
        },
        ...
      ]
    }
            │
            ▼ (webhook / job callback)
[kuji_backend llm_callback endpoint]
    (單一 tx)
    ─▶ UPDATE meetings SET summary = $1, status='done'
    ─▶ for each task in output.tasks:
          INSERT INTO tasks (..., source_segment_id = primary_clip.segment_id)
          INSERT INTO task_clips (role='primary', ...)
          for each related_clip: INSERT INTO task_clips (role='related', rank, ...)
    ─▶ enqueue routing jobs (for each task with a tag)
```

**owner 映射怎麼做**：LLM 收到 transcript `林怡君 / Emily / 怡君` 這些暱稱，要能對回 `auth_user_id=1001`。做法是 prompt 裡把 `team_members.aliases` 整張表（tenant 內）一起餵進去，LLM 產出時直接回 `owner_user_id`。映射失敗 → owner 留空白，task.owner_name 填原始名字當 fallback。

### Phase 4 · 整合路由（尚未實作）

每個新 task 完成後根據 `task.tag` 觸發 routing job：

```
task.tag == 'slack' + integrations where kind='slack' AND connected=true
            │
            ▼
[router-service · 依 config.default_channel 決定發到哪]
    POST https://slack.com/api/chat.postMessage
    Authorization: Bearer {decrypt(oauth_access_token)}
    body: channel=C01PRODUCT, text="...task.title..."
            │
            ▼ (Slack response)
寫一筆 task_events (log 表，尚未建) 記「routed_at / external_id / response」
```

其他 integration（Notion create page / GCal insert event）走類似模式，透過 provider adapter。

### Phase 5 · 使用者互動（已實作大半）

- 看 Board → 點 task card → 進 `/kuji/tasks/{id}` 看 clips + AI reasoning
- 在 Task detail 按 Play → 播放 primary clip（`audio_url + start_ms..end_ms`）
- 點「跳到逐字稿」→ `/kuji/meetings/{id}#t{start_ms}` → 自動 scroll + 高亮該 segment
- 改狀態（todo → doing → done）、改 owner、改 due：PATCH `/tasks/{id}`
- 手動新增（不走 AI）：POST `/tasks`，`meeting_id` / `source_segment_id` 可留空

---

## 5. 「task 和 action item 一樣嗎？」

**是，完全一樣**：

- 資料層：`tasks` 表是唯一 source of truth
- UI 層：`sidebar 行動事項` / `topbar「行動事項」` / `新任務 按鈕` / `/kuji/tasks/{id}` / `task_clips` 這些字面上混用，但都指同一個 entity
- 英文版 UI 裡 `Action Board` / `Action Items` / `Task` 也是混用

建議：若要嚴格區分，可以把未來需要的「AI 還沒處理完的暫存 action item 提案」另開一張表（例如 `draft_actions`），使用者確認才 INSERT 成 task。目前 MVP 不需要這層區分。

---

## 6. 現況 vs 目標

| 流程 | 現況 | 待做 |
|---|---|---|
| 使用者建會議 | ✅ POST `/meetings` OK | — |
| 音檔上傳 | ❌ UI 只建 meeting row，沒真的 upload | GCS signed URL 流程 |
| 即時錄音 | ❌ 按鈕能切換 UI，無實際錄音 | MediaRecorder + WebSocket streaming |
| ASR 轉寫 | ❌ transcript_segments 由 seed 塞 | ASR 服務整合（建議 Gemini Audio） |
| LLM 抽 task | ❌ tasks 由 seed 塞 | LLM extraction pipeline |
| AI 選 clips | ❌ task_clips 由 seed 連結 | LLM 同一步輸出 primary/related |
| Owner 映射 | ✅ team_members.aliases 已建 | prompt 把 alias 表灌給 LLM |
| Task 編輯 / CRUD | ✅ PATCH / DELETE | — |
| Play 片段 | ✅ AudioClipPlayer 已串 audio_url + seek | 真正的 GCS signed download |
| 整合路由 | ❌ config 會存、沒有實際 push | 每家 provider adapter + job queue |
| OAuth | ✅ Notion flow 可跑，其他 5 家 stub（mock connect） | Slack / GCal / Zoom / Teams / GMeet adapter |

---

## 7. 設計考量備忘

- **為何 task.source_segment_id 與 task_clips 表並存**：`source_segment_id` 是主片段的快捷 FK（查詢效率 + 前端 `source_segment_start_ms` 直接帶），`task_clips` 才是完整關聯（N 筆，可能 primary+related）。寫入時兩者同步更新，查詢時讀 clips。
- **tag 欄位不是 enum**：seed 用 `Slack` / `Notion` / `Calendar`（TitleCase 好顯示），integration kind 用 `slack` / `notion` / `gcal`（lowercase 符合 provider domain）。兩者不強綁；routing engine 負責做 `lower(tag) → kind` 的匹配。
- **meeting.summary 為 Text 欄位**：MVP 存純文字，正式化後改 JSONB 儲存結構化的 `{tldr, decisions[], questions[], blockers[]}`。
- **RLS + audit 皆有**：所有 7 張業務表啟用 RLS（`tenant_id = current_setting('app.current_tenant')`）+ audit trigger 自動填 `created_by / updated_*`。唯二例外：`integration_providers`（多 tenant 共用的 spec 表，不走 RLS）、`integration_oauth_states`（短期中間表，不加 audit）。
