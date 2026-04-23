"""seed mock data for demo tenant

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-23

對應 Kuji Frontend.html 裡的 KUJI_DATA mock：tenant_id=1（demo 診所）。
auth_user_id 對應 auth_service 0026 migration 要建的 6 個 kuji dev users
（demo@kuji.local + 5 個 member）。
"""
from typing import Sequence, Union

from alembic import op
import json


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 配對 auth_service migration 000026 seed 的 user id（預期 1001..1006）
MEMBERS = [
    {"id": 1001, "name_zh": "林怡君", "name_en": "Emily Lin", "email": "emily@acme.com",  "role": "Admin",  "aliases": ["怡君", "Emily", "EM", "Em"]},
    {"id": 1002, "name_zh": "Sam Wu", "name_en": "Sam Wu",   "email": "sam@acme.com",    "role": "Member", "aliases": ["Sam", "Sam Wu", "吳尚"]},
    {"id": 1003, "name_zh": "陳柏翰", "name_en": "Brian Chen","email": "brian@acme.com",  "role": "Member", "aliases": ["柏翰", "Brian", "BC"]},
    {"id": 1004, "name_zh": "Emma Chen","name_en": "Emma Chen","email": "emma@acme.com", "role": "Member", "aliases": ["Emma", "小 Emma"]},
    {"id": 1005, "name_zh": "張士豪", "name_en": "Ray Chang", "email": "ray@acme.com",    "role": "Member", "aliases": ["士豪", "Ray"]},
    {"id": 1006, "name_zh": "黃雅婷", "name_en": "Tina Huang","email": "tina@acme.com",   "role": "Viewer", "aliases": ["雅婷", "Tina"]},
]

TENANT = 1


def upgrade() -> None:
    # 開個 SET LOCAL app.current_tenant 讓 RLS WITH CHECK 通過 insert（app_user role）；
    # 不過 migration 以 postgres superuser 跑，superuser 會 bypass RLS policy，所以不用
    # 特別 set（FORCE ROW LEVEL SECURITY 對 superuser 是例外）。為保險還是 set 一下。
    op.execute(f"SELECT set_config('app.current_tenant', '{TENANT}', true);")

    # team_members
    for m in MEMBERS:
        aliases_json = json.dumps(m["aliases"], ensure_ascii=False).replace("'", "''")
        op.execute(
            f"""
            INSERT INTO team_members (tenant_id, auth_user_id, display_name, email, role_label, aliases)
            VALUES ({TENANT}, {m["id"]}, '{m["name_zh"]}', '{m["email"]}', '{m["role"]}', '{aliases_json}'::jsonb);
            """
        )

    # integrations
    op.execute(
        f"""
        INSERT INTO integrations (tenant_id, kind, connected, workspace_label, connected_at) VALUES
        ({TENANT}, 'notion', true,  'Acme · Product',            NOW() - INTERVAL '3 days'),
        ({TENANT}, 'slack',  true,  'acme.slack.com · #product', NOW() - INTERVAL '5 days'),
        ({TENANT}, 'gcal',   true,  'emily@acme.com',            NOW() - INTERVAL '10 days'),
        ({TENANT}, 'teams',  false, NULL,                        NULL),
        ({TENANT}, 'zoom',   true,  'emily@acme.com',            NOW() - INTERVAL '30 days'),
        ({TENANT}, 'gmeet',  false, NULL,                        NULL);
        """
    )

    # meetings — 7 筆，對應設計的 m1..m7
    # id 讓 DB 自增，但用 "day offset" 做排程時間，讓 Kuji UI 依日期能分組
    meetings = [
        ("Weekly Product Sync",   "done",       4, "2026-05-03 10:30", "2026-05-03 10:30", "2026-05-03 11:17", 2832),  # 47:12
        ("Acme Discovery Call",   "done",       3, "2026-05-03 14:00", "2026-05-03 14:00", "2026-05-03 14:38", 2284),  # 38:04
        ("User Research Review",  "done",       5, "2026-05-02 16:30", "2026-05-02 16:30", "2026-05-02 16:55", 1547),  # 25:47
        ("Q1 Business Review",    "done",       6, "2026-05-02 09:00", "2026-05-02 09:00", "2026-05-02 10:02", 3753),  # 62:33
        ("Marketing Sync",        "done",       4, "2026-05-01 15:00", "2026-05-01 15:00", "2026-05-01 15:33", 2002),  # 33:22
        ("Eng Standup",           "processing", 8, "2026-05-04 09:30", "2026-05-04 09:30", "2026-05-04 09:48", 1125),  # 18:45
        ("Offsite Planning",      "recording",  0, "2026-05-04 11:00", "2026-05-04 11:00", None,              None),
    ]
    for title, status, speakers, sched, started, ended, dur in meetings:
        ended_sql = f"'{ended}'" if ended else "NULL"
        dur_sql = str(dur) if dur else "NULL"
        op.execute(
            f"""
            INSERT INTO meetings (tenant_id, title, status, source, speaker_count, scheduled_at, started_at, ended_at, duration_sec, summary)
            VALUES ({TENANT}, '{title}', '{status}', 'record', {speakers}, '{sched}', '{started}', {ended_sql}, {dur_sql},
                '會議重點由 Kuji AI 自動產出（mock）。');
            """
        )

    # transcript segments for meeting "Weekly Product Sync" (m1)
    # 取 id 用 subquery 抓
    segments = [
        ('S1', '林怡君', 751000, 757000, '我覺得 Q2 的 roadmap 要先對齊 Pricing 那邊的變更，不然 go-to-market 會亂。', None),
        ('S2', 'Sam Wu',  757000, 763000, 'Agree. 那 roadmap deck 要不要怡君先整一版？我來補 pricing。', None),
        ('S1', '林怡君', 759000, 762000, 'OK 我週三前給你。', 'task'),
        ('S2', 'Sam Wu',  761000, 765000, '好，那 NDA 那邊我也一起處理，明天 EOD 前寄給 Acme legal。', 'task'),
        ('S3', '陳柏翰', 764000, 770000, '那我這邊先把三場客戶訪談敲好，下週一前給你們確認。', 'task'),
        ('S1', '林怡君', 767000, 772000, 'Nice, 那我們先這樣。Decision log 我等等貼 Slack。', 'decision'),
        ('S4', 'Emma Chen', 769000, 774000, "Sounds good — I'll ping people if anything's unclear.", None),
    ]
    for sp, name, start, end, text, hl in segments:
        hl_sql = f"'{hl}'" if hl else "NULL"
        text_esc = text.replace("'", "''")
        op.execute(
            f"""
            INSERT INTO transcript_segments (tenant_id, meeting_id, speaker_id, speaker_name, start_ms, end_ms, text, highlight)
            SELECT {TENANT}, id, '{sp}', '{name}', {start}, {end}, '{text_esc}', {hl_sql}
            FROM meetings WHERE tenant_id = {TENANT} AND title = 'Weekly Product Sync';
            """
        )

    # tasks — 8 筆，對應設計 t1..t8
    tasks = [
        ("更新 Q2 roadmap deck 給 Sam 看",        "todo",  1001, "Emily",   "週三 5/06",   "Notion",   "high", "Weekly Product Sync",  "「怡君可以把 Q2 roadmap 的版本更新一下，週三前給 Sam 看」", 0.94),
        ("把 NDA 初稿寄給 Acme legal",              "doing", 1002, "Sam",     "明天 17:00",  "Email",    "high", "Acme Discovery Call",   "「那 NDA 就 Sam 明天下班前寄出吧」", 0.88),
        ("排定 3 場 customer interview",            "todo",  1003, "Brian",   "下週一",      "Calendar", "med",  "Acme Discovery Call",   "「柏翰下週前要把三個客戶訪談時間敲好」", 0.91),
        ("把這輪 feedback 丟到 #product-feedback",  "done",  1004, "Emma",    "週五 5/01",   "Slack",    "low",  "User Research Review",  "「Emma 可以把這輪的 feedback 丟到 Slack 嗎」", 0.82),
        ("跟 Finance 對齊 ARR 口徑",                "todo",  1005, "Ray",     "下週三",      "Teams",    "med",  "Q1 Business Review",    "「士豪記得跟 Finance 再對一次 ARR 的算法」", 0.79),
        ("更新 Pricing 頁的企業方案 copy",          "doing", 1004, "Emma",    "下週二",      "Notion",   "med",  "Marketing Sync",        "「Pricing 那邊 Emma 幫忙把 enterprise 的 copy 更新一下」", 0.86),
        ("寄場地確認信給 Marriott",                  "todo",  1006, "Tina",    "週五",        "Email",    "low",  "Marketing Sync",        "「雅婷記得週五前跟 Marriott 確認場地」", 0.93),
        ("Review PR #482（auth flow refactor）",      "done",  1003, "Brian",   "昨天",        "GitHub",   "high", "Eng Standup",           "「Brian can you review the auth PR today」", 0.95),
    ]
    for title, status, uid, oname, due, tag, prio, mtitle, quote, conf in tasks:
        t_esc = title.replace("'", "''")
        q_esc = quote.replace("'", "''")
        op.execute(
            f"""
            INSERT INTO tasks (tenant_id, meeting_id, title, status, owner_user_id, owner_name, due_label, tag, priority, source_quote, ai_confidence)
            SELECT {TENANT},
                   (SELECT id FROM meetings WHERE tenant_id = {TENANT} AND title = '{mtitle}' LIMIT 1),
                   '{t_esc}', '{status}', {uid}, '{oname}', '{due}', '{tag}', '{prio}', '{q_esc}', {conf};
            """
        )


def downgrade() -> None:
    op.execute(f"DELETE FROM tasks WHERE tenant_id = {TENANT};")
    op.execute(f"DELETE FROM transcript_segments WHERE tenant_id = {TENANT};")
    op.execute(f"DELETE FROM meetings WHERE tenant_id = {TENANT};")
    op.execute(f"DELETE FROM integrations WHERE tenant_id = {TENANT};")
    op.execute(f"DELETE FROM team_members WHERE tenant_id = {TENANT};")
