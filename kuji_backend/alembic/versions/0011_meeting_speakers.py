"""meeting_speakers 表 — 把 ASR 的 S1/S2 對到 team_members.auth_user_id

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-23

背景：transcript_segments.speaker_id（S1/S2）是 ASR 輸出的會議內 label，
沒有 FK 到 team_members，程式無法判斷是不是 team 成員；speaker_name 只是
denormalized snapshot 字串。

新設計：meeting_speakers 表以 (meeting_id, speaker_id) 為自然鍵，
  - auth_user_id IS NOT NULL → 對到 team_members
  - auth_user_id IS NULL 且 is_external=true → 外部（客戶 / 訪客 / 未加入的同事）
  - match_source = alias_match / manual_override / unknown

外部 speaker 的 display_name 維持 AI 最後看到的稱呼；external_org 若能從
context 抽出就填（例："Acme Rep" → external_org='Acme'）。

Seed：把現有 0001/0010 seed 的 transcripts 反推出每場會議的 speaker set，
自動 JOIN team_members.aliases 做對應；對不上的標 is_external。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT = 1


def upgrade() -> None:
    op.execute(f"SELECT set_config('app.current_tenant', '{TENANT}', true);")

    # ── 1. 建表 ────────────────────────────
    op.create_table(
        "meeting_speakers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("meeting_id", sa.Integer(), nullable=False),
        sa.Column("speaker_id", sa.String(10), nullable=False),   # ASR: S1 / S2 / ...
        sa.Column("display_name", sa.String(100), nullable=False),
        # NULL → 外部 speaker / AI 未能識別
        sa.Column("auth_user_id", sa.Integer(), nullable=True),
        sa.Column("is_external", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("external_org", sa.String(100), nullable=True),
        # AI 匹配資訊
        sa.Column("match_source", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("match_confidence", sa.Numeric(3, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("meeting_id", "speaker_id", name="uq_meeting_speakers_meeting_speaker"),
    )
    op.create_index("idx_meeting_speakers_tenant", "meeting_speakers", ["tenant_id"])
    op.create_index("idx_meeting_speakers_user", "meeting_speakers", ["auth_user_id"])

    # RLS + audit
    op.execute("ALTER TABLE meeting_speakers ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE meeting_speakers FORCE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON meeting_speakers
            FOR ALL TO PUBLIC
            USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
                OR current_setting('app.bypass_rls', true) = 'true')
            WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
                OR current_setting('app.bypass_rls', true) = 'true');
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_speakers TO app_user;")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE meeting_speakers_id_seq TO app_user;")

    op.execute("""
        ALTER TABLE meeting_speakers
            ADD COLUMN IF NOT EXISTS created_by INT,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_by INT,
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS deleted_by INT;
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS trg_meeting_speakers_audit ON meeting_speakers;
        CREATE TRIGGER trg_meeting_speakers_audit
            BEFORE INSERT OR UPDATE ON meeting_speakers
            FOR EACH ROW EXECUTE FUNCTION audit_autofill();
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_meeting_speakers_not_deleted ON meeting_speakers (id) WHERE deleted_at IS NULL;")

    # ── 2. Seed：每個會議的 speakers 自動 alias_match ──
    # 從 transcript_segments 撈 DISTINCT (meeting, speaker_id, speaker_name)，
    # LATERAL JOIN team_members.aliases（含 display_name）找 auth_user_id。
    op.execute(f"""
        WITH speakers AS (
            SELECT DISTINCT tenant_id, meeting_id, speaker_id, speaker_name
            FROM transcript_segments
            WHERE tenant_id = {TENANT}
        ),
        matched AS (
            SELECT
                sp.tenant_id,
                sp.meeting_id,
                sp.speaker_id,
                sp.speaker_name,
                tm.auth_user_id,
                tm.display_name AS canonical_name
            FROM speakers sp
            LEFT JOIN LATERAL (
                SELECT tm2.auth_user_id, tm2.display_name
                FROM team_members tm2
                WHERE tm2.tenant_id = sp.tenant_id
                  AND tm2.deleted_at IS NULL
                  AND (
                      tm2.display_name = sp.speaker_name
                      OR sp.speaker_name = ANY(
                          ARRAY(SELECT jsonb_array_elements_text(tm2.aliases))
                      )
                  )
                LIMIT 1
            ) tm ON true
        )
        INSERT INTO meeting_speakers
            (tenant_id, meeting_id, speaker_id, display_name,
             auth_user_id, is_external, external_org,
             match_source, match_confidence)
        SELECT
            tenant_id,
            meeting_id,
            speaker_id,
            COALESCE(canonical_name, speaker_name) AS display_name,
            auth_user_id,
            (auth_user_id IS NULL) AS is_external,
            -- Acme Rep → Acme；其他外部留 NULL 讓 admin 事後補
            CASE
                WHEN auth_user_id IS NULL AND speaker_name ILIKE '%Acme%' THEN 'Acme'
                ELSE NULL
            END AS external_org,
            CASE WHEN auth_user_id IS NULL THEN 'unknown' ELSE 'alias_match' END AS match_source,
            CASE WHEN auth_user_id IS NULL THEN NULL ELSE 0.98 END AS match_confidence
        FROM matched
        ON CONFLICT (meeting_id, speaker_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_table("meeting_speakers")
