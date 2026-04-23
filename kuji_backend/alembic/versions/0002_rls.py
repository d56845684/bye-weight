"""row-level security + tenant isolation

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-23

建 cluster-level role `app_user`（若尚未存在）、所有 tenant-scoped 表啟用 RLS。
app_user 是 cluster-wide role，跟 app_db 共用同一個。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = [
    "meetings",
    "transcript_segments",
    "tasks",
    "integrations",
    "team_members",
]


def upgrade() -> None:
    # 1. 建 app_user role（cluster-wide；若 app_db migration 先跑過就已存在）
    op.execute(
        """
        DO $$
        BEGIN
            CREATE ROLE app_user NOINHERIT;
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END $$;
        """
    )

    # 2. 啟用 RLS + tenant_isolation policy
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
                FOR ALL
                TO PUBLIC
                USING (
                    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
                    OR current_setting('app.bypass_rls', true) = 'true'
                )
                WITH CHECK (
                    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
                    OR current_setting('app.bypass_rls', true) = 'true'
                );
            """
        )

    # 3. 授權 app_user
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;"
    )
    op.execute(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;"
    )


def downgrade() -> None:
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user;")
    op.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user;")
    for table in reversed(TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
