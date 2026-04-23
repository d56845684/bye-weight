"""為所有會議 seed 逐字稿 + 補 tasks 4-8 的 primary/related clips

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-23

0004 只有 Weekly Product Sync (m1) 有逐字稿，其他 6 場會議 transcript 是空的。
這次補齊：meetings 2-7 每場 5-8 段 transcript（recording 狀態的 offsite 只有 2 段表「剛開始」）。

同時把 tasks 4-8 接上對應會議的 transcript 片段（primary + 0-2 related）。
tasks 1-3 已在 0008 連好（ref Weekly Product Sync），這次不動。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT = 1


# 每場會議的逐字稿：(meeting_title, [(speaker_id, speaker_name, start_ms, end_ms, text, highlight), ...])
TRANSCRIPTS = {
    "Acme Discovery Call": [
        ("S1", "林怡君",   45000,   52000,  "感謝 Acme 今天抽空，我們先花 30 分鐘了解你們會議整理的現況。", None),
        ("S4", "Acme Rep", 72000,   85000,  "我們現在主要用 Notion + Slack，但 cross-team 的 action item 很常漏追。", None),
        ("S1", "林怡君",   612000,  622000, "Kuji 最核心就是這點 — AI 會把 action items 抓出來、指到對的人。", None),
        ("S2", "Sam Wu",   935000,  948000, "Acme 法務那邊要 mutual NDA，我們走標準版可以嗎？", None),
        ("S4", "Acme Rep", 955000,  965000, "可以，但要先給我們 legal 看過。", None),
        ("S2", "Sam Wu",  2052000, 2068000, "好，那 NDA 就我明天下班前寄給 Acme legal。", "task"),
        ("S1", "林怡君",  2082000, 2094000, "OK，另外我們下週會需要三場客戶訪談，柏翰可以幫忙敲嗎？", None),
        ("S3", "陳柏翰",  2110000, 2124000, "沒問題，下週一前把時間給你們。", "task"),
    ],
    "User Research Review": [
        ("S1", "林怡君",   30000,   42000,  "這輪做了 10 個 user interview，大家對體驗的整體回饋先聊一下。", None),
        ("S4", "Emma Chen", 92000,  110000, "準確度滿意，但 confidence bar 有 3/10 的 user 沒注意到那條線。", None),
        ("S5", "張士豪",  205000,  220000, "Owner assignment 有錯派的時候，建議做到能一鍵 undo。", None),
        ("S1", "林怡君",  338000,  352000, "這些 feedback 我們要歸檔到哪？", None),
        ("S4", "Emma Chen", 502000, 518000, "Emma 可以把這輪的 feedback 丟到 Slack 嗎，標 #product-feedback。", "task"),
        ("S4", "Emma Chen", 520000, 532000, "好，我今天晚上前整理完 thread 發。", None),
        ("S1", "林怡君", 1120000, 1140000, "先這樣，decision log 我等等貼 Slack。", "decision"),
    ],
    "Q1 Business Review": [
        ("S1", "林怡君",   30000,   45000,  "今天 Q1 BR，重點放在 ARR、retention、跟 Q2 pipeline 三塊。", None),
        ("S5", "張士豪",  120000,  150000, "ARR 我先講結論：Q1 end 1.4M，QoQ +22%。", None),
        ("S1", "林怡君",  750000,  762000, "Logo churn 的數字看起來怪怪的，Finance 那邊是怎麼算？", None),
        ("S5", "張士豪",  775000,  795000, "他們把 contraction 也算進去，我這邊只算 full cancel。", None),
        ("S1", "林怡君", 2730000, 2748000, "士豪記得跟 Finance 再對一次 ARR 的算法。", "task"),
        ("S5", "張士豪", 2752000, 2762000, "OK 下週前我拉一次 sync。", None),
        ("S1", "林怡君", 3620000, 3640000, "Retention cohort 的部分我們下次再展開。", None),
    ],
    "Marketing Sync": [
        ("S1", "林怡君",   30000,   45000,  "今天兩個主題：enterprise pricing 頁的 copy、offsite 的場地。", None),
        ("S4", "Emma Chen", 120000,  140000, "Pricing 頁目前 enterprise tier 的描述太籠統，conversion data 顯示效果不好。", None),
        ("S1", "林怡君",  1125000, 1138000, "Pricing 那邊 Emma 幫忙把 enterprise 的 copy 更新一下。", "task"),
        ("S4", "Emma Chen", 1142000, 1155000, "下週二給你看 draft。", None),
        ("S6", "黃雅婷",  1685000, 1705000, "Offsite 場地還在跟 Marriott 談，他們這週會回我 final quote。", None),
        ("S1", "林怡君",  1688000, 1702000, "雅婷記得週五前跟 Marriott 確認場地。", "task"),
        ("S6", "黃雅婷",  1720000, 1735000, "了解，週五前敲定。", None),
    ],
    "Eng Standup": [
        ("S1", "林怡君",    15000,   32000, "今天 eng standup。有幾個 PR 卡住，我們 triage 一下。", None),
        ("S3", "陳柏翰",    75000,   92000, "我這邊 PR #480 和 #482 都在等 review。", None),
        ("S1", "林怡君",   190000,  210000, "Brian can you review the auth PR today.", "task"),
        ("S3", "陳柏翰",   212000,  225000, "Sure, 今天傍晚前 review 完。", None),
        ("S7", "Alex Lin", 380000,  405000, "另外 migration 0010 我想放到明早低流量時段跑。", None),
        ("S1", "林怡君",   560000,  580000, "聽起來沒問題，排明天 07:00 UTC。", None),
    ],
    "Offsite Planning": [
        # status=recording 的會議，只有剛開始 2 段
        ("S1", "林怡君",   15000,   32000, "Offsite planning meeting 開始，先確認目標：團建 + Q3 strategy review。", None),
        ("S6", "黃雅婷",   40000,   55000, "場地這邊 Marriott 已經 hold，最終確認會在週五。", None),
    ],
}


# tasks 4-8 的 clip linkage：(task_title, [(segment_text_like, role, rank, confidence, note), ...])
CLIP_LINKS = [
    ("把這輪 feedback 丟到 #product-feedback", [
        ("%Emma 可以把這輪的 feedback 丟到 Slack%", "primary", 0, 0.82, "明確指派 + routing 到 Slack"),
        ("%好，我今天晚上前整理完 thread 發%",       "related", 1, 0.68, "承諾時限"),
    ]),
    ("跟 Finance 對齊 ARR 口徑", [
        ("%士豪記得跟 Finance 再對一次 ARR 的算法%", "primary", 0, 0.79, "明確 action + 人"),
        ("%他們把 contraction 也算進去%",             "related", 1, 0.64, "問題背景：口徑差異"),
        ("%OK 下週前我拉一次 sync%",                  "related", 2, 0.60, "承諾時限"),
    ]),
    ("更新 Pricing 頁的企業方案 copy", [
        ("%Pricing 那邊 Emma 幫忙把 enterprise 的 copy 更新%", "primary", 0, 0.86, "明確指派"),
        ("%Pricing 頁目前 enterprise tier 的描述太籠統%",       "related", 1, 0.63, "為什麼要改的 context"),
        ("%下週二給你看 draft%",                                  "related", 2, 0.58, "承諾時限"),
    ]),
    ("寄場地確認信給 Marriott", [
        ("%雅婷記得週五前跟 Marriott 確認場地%",   "primary", 0, 0.93, "明確承諾"),
        ("%Offsite 場地還在跟 Marriott 談%",        "related", 1, 0.61, "狀態 context"),
    ]),
    ("Review PR #482（auth flow refactor）", [
        ("%Brian can you review the auth PR today%", "primary", 0, 0.95, "直接 mention + 動詞"),
        ("%Sure, 今天傍晚前 review 完%",              "related", 1, 0.72, "接下來確認"),
    ]),
]


def upgrade() -> None:
    op.execute(f"SELECT set_config('app.current_tenant', '{TENANT}', true);")

    # 1. Seed transcripts
    for meeting_title, segs in TRANSCRIPTS.items():
        safe_title = meeting_title.replace("'", "''")
        for sp, name, start, end, text, hl in segs:
            text_esc = text.replace("'", "''")
            hl_sql = f"'{hl}'" if hl else "NULL"
            name_esc = name.replace("'", "''")
            op.execute(f"""
                INSERT INTO transcript_segments
                    (tenant_id, meeting_id, speaker_id, speaker_name, start_ms, end_ms, text, highlight)
                SELECT {TENANT}, id, '{sp}', '{name_esc}', {start}, {end}, '{text_esc}', {hl_sql}
                FROM meetings WHERE tenant_id = {TENANT} AND title = '{safe_title}';
            """)

    # 2. Link task_clips for tasks 4-8
    for task_title, clips in CLIP_LINKS:
        safe_title = task_title.replace("'", "''")
        for segment_like, role, rank, conf, note in clips:
            note_esc = note.replace("'", "''") if note else None
            note_sql = f"'{note_esc}'" if note_esc else "NULL"
            op.execute(f"""
                INSERT INTO task_clips (tenant_id, task_id, segment_id, role, rank, ai_confidence, note)
                SELECT {TENANT},
                       (SELECT id FROM tasks WHERE tenant_id={TENANT} AND title='{safe_title}' LIMIT 1),
                       (SELECT s.id FROM transcript_segments s
                        JOIN tasks t ON t.meeting_id = s.meeting_id
                        WHERE s.tenant_id = {TENANT}
                          AND t.title = '{safe_title}'
                          AND s.text LIKE '{segment_like}'
                        LIMIT 1),
                       '{role}', {rank}, {conf}, {note_sql};
            """)

    # 3. 順便把 tasks 4-8 的 source_segment_id 指向 primary clip 的 segment（跟 tasks 1-3 一致）
    for task_title, clips in CLIP_LINKS:
        primary_like = next((c[0] for c in clips if c[1] == "primary"), None)
        if not primary_like:
            continue
        safe_title = task_title.replace("'", "''")
        op.execute(f"""
            UPDATE tasks SET source_segment_id = (
                SELECT s.id FROM transcript_segments s
                JOIN tasks t ON t.meeting_id = s.meeting_id
                WHERE s.tenant_id = {TENANT}
                  AND t.title = '{safe_title}'
                  AND s.text LIKE '{primary_like}'
                LIMIT 1
            )
            WHERE tenant_id = {TENANT} AND title = '{safe_title}';
        """)


def downgrade() -> None:
    # 清掉 clips
    op.execute(f"""
        DELETE FROM task_clips WHERE tenant_id = {TENANT}
          AND task_id IN (SELECT id FROM tasks WHERE tenant_id = {TENANT} AND title IN (
              '把這輪 feedback 丟到 #product-feedback',
              '跟 Finance 對齊 ARR 口徑',
              '更新 Pricing 頁的企業方案 copy',
              '寄場地確認信給 Marriott',
              'Review PR #482（auth flow refactor）'
          ));
    """)
    op.execute(f"""
        UPDATE tasks SET source_segment_id = NULL
        WHERE tenant_id = {TENANT} AND title IN (
            '把這輪 feedback 丟到 #product-feedback',
            '跟 Finance 對齊 ARR 口徑',
            '更新 Pricing 頁的企業方案 copy',
            '寄場地確認信給 Marriott',
            'Review PR #482（auth flow refactor）'
        );
    """)
    # 清掉 transcripts（只清 0010 新加的，meeting 1 的不動）
    op.execute(f"""
        DELETE FROM transcript_segments WHERE tenant_id = {TENANT}
          AND meeting_id IN (SELECT id FROM meetings WHERE tenant_id = {TENANT} AND title IN (
              'Acme Discovery Call', 'User Research Review', 'Q1 Business Review',
              'Marketing Sync', 'Eng Standup', 'Offsite Planning'
          ));
    """)
