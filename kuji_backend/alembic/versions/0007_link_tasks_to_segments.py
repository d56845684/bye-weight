"""把 seed tasks 連回對應的 transcript segment

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-23

0004 seed 的 tasks 有 source_quote 但沒 source_segment_id。
此 migration 依「首個字」比對把 tasks 1/2/3 連到 "Weekly Product Sync" 裡 hl='task' 的 3 段 transcript，
並把 tasks 2/3 的 meeting_id 統一指向 Weekly Product Sync（原本 seed 分散到不同會議但 transcript 只 seed 了 m1）。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT = 1


def upgrade() -> None:
    # 先確保能改（superuser 跑 migration 不受 RLS 限制）
    op.execute(f"SELECT set_config('app.current_tenant', '{TENANT}', true);")

    # 把 tasks 2、3 的 meeting 改到 Weekly Product Sync（id 由 title 查，避免寫死）
    op.execute(f"""
        UPDATE tasks SET meeting_id = (
            SELECT id FROM meetings WHERE tenant_id = {TENANT} AND title = 'Weekly Product Sync' LIMIT 1
        )
        WHERE tenant_id = {TENANT}
          AND title IN (
            '更新 Q2 roadmap deck 給 Sam 看',
            '把 NDA 初稿寄給 Acme legal',
            '排定 3 場 customer interview'
          );
    """)

    # 連結 tasks → transcript_segments
    # segment 1 (start 759000, hl=task, speaker 林怡君「OK 我週三前給你」) → task "更新 Q2 roadmap deck..."
    # segment 2 (start 761000, hl=task, speaker Sam「NDA 那邊我也一起處理...」) → task "把 NDA 初稿寄給..."
    # segment 3 (start 764000, hl=task, speaker 陳柏翰「三場客戶訪談...」) → task "排定 3 場 customer interview"
    linkages = [
        ("更新 Q2 roadmap deck 給 Sam 看",    "OK 我週三前給你%"),
        ("把 NDA 初稿寄給 Acme legal",           "%NDA 那邊我也一起處理%"),
        ("排定 3 場 customer interview",         "%三場客戶訪談%"),
    ]
    for task_title, quote_like in linkages:
        # 用 LIKE 比對段內容，避免標點 / quote 引號差異
        op.execute(f"""
            UPDATE tasks SET source_segment_id = (
                SELECT s.id FROM transcript_segments s
                WHERE s.tenant_id = {TENANT}
                  AND s.text LIKE '{quote_like}'
                  AND s.highlight = 'task'
                LIMIT 1
            )
            WHERE tenant_id = {TENANT} AND title = '{task_title.replace("'", "''")}';
        """)


def downgrade() -> None:
    op.execute(f"""
        UPDATE tasks SET source_segment_id = NULL
        WHERE tenant_id = {TENANT};
    """)
