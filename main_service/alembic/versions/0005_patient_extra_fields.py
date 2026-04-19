"""patients: add national_id + address (tenant-scoped unique on national_id)

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-19

self-register 流程需要讓使用者自己填：中文姓名、身分證、性別、地址、電話、生日。
national_id 在同一 tenant 內不可重複；不同 tenant 可共存（partial index 處理 NULL）。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE patients
            ADD COLUMN IF NOT EXISTS national_id VARCHAR(20),
            ADD COLUMN IF NOT EXISTS address VARCHAR(200);
        """
    )
    # partial unique：允許多筆 national_id IS NULL，但同 tenant 內非 NULL 不可重複
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_national_id
            ON patients (tenant_id, national_id)
            WHERE national_id IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_patients_tenant_national_id;")
    op.execute(
        """
        ALTER TABLE patients
            DROP COLUMN IF EXISTS address,
            DROP COLUMN IF EXISTS national_id;
        """
    )
