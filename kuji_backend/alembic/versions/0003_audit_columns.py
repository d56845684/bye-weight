"""audit columns + autofill trigger

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-23

所有業務表加稽核欄位：created_by / updated_at / updated_by / deleted_at / deleted_by。
Trigger 讀 PostgreSQL session 變數 app.current_user 自動填。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


AUDITED_TABLES = [
    "meetings",
    "transcript_segments",
    "tasks",
    "integrations",
    "team_members",
]


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_autofill() RETURNS TRIGGER AS $$
        DECLARE
            uid INT;
        BEGIN
            BEGIN
                uid := NULLIF(current_setting('app.current_user', true), '')::INT;
            EXCEPTION WHEN others THEN
                uid := NULL;
            END;

            IF TG_OP = 'INSERT' THEN
                IF NEW.created_by IS NULL THEN
                    NEW.created_by := uid;
                END IF;
            ELSIF TG_OP = 'UPDATE' THEN
                NEW.updated_at := NOW();
                NEW.updated_by := uid;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    for table in AUDITED_TABLES:
        op.execute(
            f"""
            ALTER TABLE {table}
                ADD COLUMN IF NOT EXISTS created_by INT,
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS updated_by INT,
                ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS deleted_by INT;
            """
        )
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_audit ON {table};")
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_audit
                BEFORE INSERT OR UPDATE ON {table}
                FOR EACH ROW EXECUTE FUNCTION audit_autofill();
            """
        )
        # deleted_at partial index 讓「查未軟刪」快
        op.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{table}_not_deleted ON {table} (id) WHERE deleted_at IS NULL;"
        )

    op.execute("GRANT EXECUTE ON FUNCTION audit_autofill() TO app_user;")


def downgrade() -> None:
    for table in AUDITED_TABLES:
        op.execute(f"DROP INDEX IF EXISTS idx_{table}_not_deleted;")
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_audit ON {table};")
        op.execute(
            f"""
            ALTER TABLE {table}
                DROP COLUMN IF EXISTS deleted_by,
                DROP COLUMN IF EXISTS deleted_at,
                DROP COLUMN IF EXISTS updated_by,
                DROP COLUMN IF EXISTS updated_at,
                DROP COLUMN IF EXISTS created_by;
            """
        )
    op.execute("DROP FUNCTION IF EXISTS audit_autofill();")
