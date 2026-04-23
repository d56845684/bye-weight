"""meetings.audio_url + task_clips 表 + seed 3 個主 task 的片段

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-23

MVP：每個 task 由 AI 識別 1 個主片段 + 0-2 個相關片段（設計：「主片段 = 承諾的瞬間」，
相關片段 = 前後提供脈絡的對話）。

seed：
  task 1 (更新 Q2 roadmap deck) → primary "OK 我週三前給你" + 2 related（前後 context）
  task 2 (NDA) → primary "NDA 那邊我也一起處理..." + 1 related（Sam 的 roadmap 回應為 context）
  task 3 (customer interview) → primary "三場客戶訪談" + 0 related
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT = 1
DEMO_AUDIO_URL = "/kuji/sample/meeting-demo.mp3"


def upgrade() -> None:
    # ── 1. meetings.audio_url ─────────────────
    op.add_column("meetings", sa.Column("audio_url", sa.Text(), nullable=True))

    # seed：所有 done 狀態的 meeting 都給 demo 音檔；processing / recording 留 NULL
    op.execute(f"""
        UPDATE meetings SET audio_url = '{DEMO_AUDIO_URL}'
        WHERE tenant_id = {TENANT} AND status = 'done';
    """)

    # ── 2. task_clips 表 ─────────────────────
    op.create_table(
        "task_clips",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("segment_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="primary"),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ai_confidence", sa.Numeric(3, 2), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["segment_id"], ["transcript_segments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_task_clips_tenant", "task_clips", ["tenant_id"])
    op.create_index("idx_task_clips_task_role", "task_clips", ["task_id", "role", "rank"])

    # 啟用 RLS + audit（跟其他表對齊）
    op.execute("ALTER TABLE task_clips ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE task_clips FORCE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON task_clips
            FOR ALL TO PUBLIC
            USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
                OR current_setting('app.bypass_rls', true) = 'true')
            WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
                OR current_setting('app.bypass_rls', true) = 'true');
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON task_clips TO app_user;")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE task_clips_id_seq TO app_user;")

    # audit 欄位 + trigger
    op.execute("""
        ALTER TABLE task_clips
            ADD COLUMN IF NOT EXISTS created_by INT,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_by INT,
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS deleted_by INT;
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS trg_task_clips_audit ON task_clips;
        CREATE TRIGGER trg_task_clips_audit
            BEFORE INSERT OR UPDATE ON task_clips
            FOR EACH ROW EXECUTE FUNCTION audit_autofill();
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_task_clips_not_deleted ON task_clips (id) WHERE deleted_at IS NULL;")

    # ── 3. Seed clips ─────────────────────
    op.execute(f"SELECT set_config('app.current_tenant', '{TENANT}', true);")

    # 輔助：用 task title + segment text LIKE 比對，取 id 後插入
    def seed_clip(task_title, segment_like, role, rank, conf, note):
        safe_title = task_title.replace("'", "''")
        op.execute(f"""
            INSERT INTO task_clips (tenant_id, task_id, segment_id, role, rank, ai_confidence, note)
            SELECT {TENANT},
                   (SELECT id FROM tasks WHERE tenant_id={TENANT} AND title='{safe_title}' LIMIT 1),
                   (SELECT id FROM transcript_segments WHERE tenant_id={TENANT} AND text LIKE '{segment_like}' LIMIT 1),
                   '{role}', {rank}, {conf},
                   {f"'{note}'" if note else 'NULL'};
        """)

    # task 1 · 更新 Q2 roadmap deck 給 Sam 看
    seed_clip("更新 Q2 roadmap deck 給 Sam 看", "OK 我週三前給你%",           "primary", 0, 0.94, "明確承諾 + 期限")
    seed_clip("更新 Q2 roadmap deck 給 Sam 看", "%Q2 的 roadmap 要先對齊 Pricing%", "related", 1, 0.71, "提出需求的 context")
    seed_clip("更新 Q2 roadmap deck 給 Sam 看", "%roadmap deck 要不要怡君先整一版%", "related", 2, 0.68, "指派的對話脈絡")

    # task 2 · 把 NDA 初稿寄給 Acme legal
    seed_clip("把 NDA 初稿寄給 Acme legal", "%NDA 那邊我也一起處理%", "primary", 0, 0.88, "時限承諾")
    seed_clip("把 NDA 初稿寄給 Acme legal", "%roadmap deck 要不要怡君先整一版%", "related", 1, 0.55, "任務出現的對話脈絡")

    # task 3 · 排定 3 場 customer interview
    seed_clip("排定 3 場 customer interview", "%三場客戶訪談%", "primary", 0, 0.91, "獨立承諾，無需脈絡")


def downgrade() -> None:
    op.execute(f"DELETE FROM task_clips WHERE tenant_id = {TENANT};")
    op.drop_table("task_clips")
    op.drop_column("meetings", "audio_url")
