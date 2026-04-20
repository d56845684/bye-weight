"""patients: add chart_no (病歷號) + inbody_pending.ocr_chart_no

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-20

需求：
- 病患管理加「病歷號」chart_no，現有系統 HIS 的主鍵，同 tenant 內不可重複。
- InBody 報告通常會印 chart_no；LINE 自動辨識流程優先用 chart_no 精準對應
  病患（比姓名+生日穩定很多）。
- inbody_pending 也存 ocr_chart_no，人工處理時能看到 OCR 讀到什麼。

his_id 早在 0001 就有（predates IAM rewrite）；本 migration 不動，只是把它
從 UI 漏掉的部分補回去（schema + admin page 改在 app 層）。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS chart_no VARCHAR(20);
        ALTER TABLE inbody_pending ADD COLUMN IF NOT EXISTS ocr_chart_no VARCHAR(20);
        """
    )
    # partial unique：允許多筆 chart_no IS NULL；非 NULL 在同 tenant 內不可重複
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_chart_no
            ON patients (tenant_id, chart_no)
            WHERE chart_no IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_patients_tenant_chart_no;")
    op.execute(
        """
        ALTER TABLE inbody_pending DROP COLUMN IF EXISTS ocr_chart_no;
        ALTER TABLE patients DROP COLUMN IF EXISTS chart_no;
        """
    )
