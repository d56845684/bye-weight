"""init schema + tenant_id

Revision ID: 0001
Revises:
Create Date: 2026-04-23

建立 Kuji 所有業務表。跟 main_service 不同的地方：tenant_id 從 day 1
就是 required，不需要後續 migration 補。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # meetings
    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("duration_sec", sa.Integer(), nullable=True),
        sa.Column("speaker_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="done"),
        sa.Column("source", sa.String(20), nullable=False, server_default="upload"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_meetings_tenant", "meetings", ["tenant_id"])
    op.create_index("idx_meetings_tenant_scheduled", "meetings", ["tenant_id", sa.text("scheduled_at DESC")])

    # transcript_segments
    op.create_table(
        "transcript_segments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("meeting_id", sa.Integer(), nullable=False),
        sa.Column("speaker_id", sa.String(10), nullable=False),
        sa.Column("speaker_name", sa.String(100), nullable=True),
        sa.Column("start_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("end_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("highlight", sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_segments_meeting", "transcript_segments", ["meeting_id", "start_ms"])
    op.create_index("idx_segments_tenant", "transcript_segments", ["tenant_id"])

    # tasks
    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("meeting_id", sa.Integer(), nullable=True),
        sa.Column("source_segment_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="todo"),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("owner_name", sa.String(100), nullable=True),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("due_label", sa.String(50), nullable=True),
        sa.Column("tag", sa.String(20), nullable=True),
        sa.Column("priority", sa.String(10), nullable=False, server_default="med"),
        sa.Column("source_quote", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Numeric(3, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_segment_id"], ["transcript_segments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_tasks_tenant", "tasks", ["tenant_id"])
    op.create_index("idx_tasks_tenant_status", "tasks", ["tenant_id", "status"])
    op.create_index("idx_tasks_owner", "tasks", ["owner_user_id"])
    op.create_index("idx_tasks_meeting", "tasks", ["meeting_id"])

    # integrations
    op.create_table(
        "integrations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("connected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("workspace_label", sa.String(200), nullable=True),
        sa.Column("connected_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "kind", name="uq_integrations_tenant_kind"),
    )
    op.create_index("idx_integrations_tenant", "integrations", ["tenant_id"])

    # team_members
    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("auth_user_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("role_label", sa.String(20), nullable=False, server_default="Member"),
        sa.Column("aliases", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "auth_user_id", name="uq_team_tenant_user"),
    )
    op.create_index("idx_team_tenant", "team_members", ["tenant_id"])
    op.create_index("idx_team_auth_user", "team_members", ["auth_user_id"])


def downgrade() -> None:
    op.drop_table("team_members")
    op.drop_table("integrations")
    op.drop_table("tasks")
    op.drop_table("transcript_segments")
    op.drop_table("meetings")
