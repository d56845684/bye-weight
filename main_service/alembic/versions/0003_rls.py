"""row-level security + tenant isolation policy

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-18

在所有 tenant-scoped 表上啟用 PostgreSQL Row-Level Security。
runtime query 會 `SET LOCAL app.current_tenant = X`；RLS policy 讀此 session
變數，不符的 row 自動隱形、INSERT 禁寫。

為了讓 dev 環境連的 postgres superuser 不會 bypass RLS，建立 app_user 非
superuser role；main_service 每個 transaction 起頭 `SET LOCAL ROLE app_user`
（database.py 的 event listener）。alembic migration 本身仍以 postgres
superuser 身份執行 DDL。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = [
    "patients",
    "line_bindings",
    "employees",
    "visits",
    "medications",
    "inbody_records",
    "inbody_pending",
    "food_logs",
    "notification_rules",
    "notification_logs",
]


def upgrade() -> None:
    # 1. 建立 app_user role（已存在就略過）
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

    # 2. 每張 tenant-scoped 表：啟用 + FORCE RLS、建立 tenant_isolation policy
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

    # 3. 授權 app_user 讀寫所有業務表
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
    # app_user role 保留（可能有其他東西依賴）；要手動 `DROP ROLE app_user` 再清
