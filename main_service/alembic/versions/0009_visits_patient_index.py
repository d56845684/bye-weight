"""visits: composite index (patient_id, visit_date DESC)

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-21

痛點：
- /visits/me/timeline 跟 /patients/{id}/detail 都用
    WHERE patient_id = X AND tenant_id = Y ORDER BY visit_date DESC
  但 visits 只有 (tenant_id) 單欄 index，planner 走 bitmap on tenant + filter
  patient_id + sort。病患量或就診量上來會變慢。

- food_logs 已經有 (patient_id, logged_at DESC)；inbody_records 已經有
  (patient_id, measured_at DESC)。visits 是唯一還沒有「以病患為主 + 時間倒序」
  的業務表。

加 partial on deleted_at IS NULL，軟刪 row 不佔 index。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_visits_patient_date
            ON visits (patient_id, visit_date DESC)
            WHERE deleted_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_visits_patient_date;")
