"""blood_test_reports: Healthleader 抽血報告同步落地表

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-03

後台手動同步 Healthleader（manage.healthleader.com.tw）抽血報告，逐病患抓報告、
解析 SVG 取 37 項檢驗值，寫進此表。一筆 = HL 一份報告（hl_report_id = report.ID）。
檢驗值整包存 JSONB（lab_values），結構化關鍵欄做查詢 / 去重。

RLS + audit 走既有 pattern（0003 / 0004）：
  - tenant_id NOT NULL，tenant_isolation policy + FORCE ROW LEVEL SECURITY
  - audit 五欄 + trigger audit_autofill
  - app_user 拿 SELECT / INSERT / UPDATE / DELETE + sequence USAGE
去重：partial unique index (tenant_id, hl_report_id) WHERE deleted_at IS NULL。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE blood_test_reports (
            id            SERIAL PRIMARY KEY,
            patient_id    INTEGER NOT NULL REFERENCES patients(id),
            tenant_id     INTEGER NOT NULL DEFAULT 0,
            hl_report_id  VARCHAR(64) NOT NULL,
            hl_mrno       VARCHAR(32),
            detect_no     VARCHAR(64),
            clinic_name   VARCHAR(100),
            test_date     TIMESTAMP NOT NULL,
            lab_values    JSONB,
            svg_url       TEXT,
            created_at    TIMESTAMP DEFAULT NOW(),
            created_by    INTEGER,
            updated_at    TIMESTAMP,
            updated_by    INTEGER,
            deleted_at    TIMESTAMP,
            deleted_by    INTEGER
        );
        CREATE INDEX idx_blood_test_tenant
            ON blood_test_reports (tenant_id)
            WHERE deleted_at IS NULL;
        CREATE INDEX idx_blood_test_patient
            ON blood_test_reports (patient_id, test_date)
            WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX uq_blood_test_hl_report
            ON blood_test_reports (tenant_id, hl_report_id)
            WHERE deleted_at IS NULL;
        """
    )

    op.execute("ALTER TABLE blood_test_reports ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE blood_test_reports FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON blood_test_reports
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

    op.execute(
        """
        CREATE TRIGGER trg_blood_test_reports_audit
            BEFORE INSERT OR UPDATE ON blood_test_reports
            FOR EACH ROW EXECUTE FUNCTION audit_autofill();
        """
    )

    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON blood_test_reports TO app_user;"
    )
    op.execute(
        "GRANT USAGE, SELECT ON SEQUENCE blood_test_reports_id_seq TO app_user;"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_blood_test_reports_audit ON blood_test_reports;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON blood_test_reports;")
    op.execute("ALTER TABLE blood_test_reports DISABLE ROW LEVEL SECURITY;")
    op.execute("DROP TABLE blood_test_reports;")
