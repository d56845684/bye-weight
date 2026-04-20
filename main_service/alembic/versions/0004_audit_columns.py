"""audit columns + autofill trigger

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-19

所有業務表加稽核欄位：created_by / updated_at / updated_by / deleted_at / deleted_by。
Trigger 讀 PostgreSQL session 變數 app.current_user 自動填（main_service 的 get_db
在 after_begin 用 SET LOCAL 注入）。deleted_at / deleted_by 不自動，靠應用層做
soft delete 時明確寫入。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 10 張業務表全部納入（含 notification_logs，讓它的失敗/成功也留稽核）
AUDITED_TABLES = [
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
    # 1. Trigger function
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

    # 2. 對每張表加欄位 + 綁 trigger
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

    # 3. app_user 需要使用 audit_autofill()；trigger 以 definer 身份執行，
    #    但 plpgsql 函式呼叫只需要 EXECUTE 權限
    op.execute("GRANT EXECUTE ON FUNCTION audit_autofill() TO app_user;")


def downgrade() -> None:
    for table in AUDITED_TABLES:
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
