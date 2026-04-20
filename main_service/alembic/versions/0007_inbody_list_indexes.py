"""inbody_records + inbody_pending: composite indexes for admin list queries

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-20

痛點：
- `GET /inbody/records` 以 tenant 過濾 + `ORDER BY measured_at DESC` 分頁。
  原本只有 `idx_inbody_records_tenant (tenant_id)` 單欄 index → planner 會 index scan
  撈 tenant 範圍再 sort。Row 量大時 sort 是 O(n log n) 瓶頸。
- `GET /inbody/pending` 同樣 pattern：tenant_id + `ORDER BY uploaded_at DESC`。

解法：加 `(tenant_id, <time_col> DESC)` 複合 index。planner 直接走 index 順序讀，
免 sort，配合 LIMIT 分頁 cost 降到 O(limit)。

舊單欄 tenant index 保留 — 寫入時的 hot-path（簡單 tenant 查詢）還會用到，
而且 drop 會 lock table；留著成本低。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_inbody_records_tenant_measured
            ON inbody_records (tenant_id, measured_at DESC)
            WHERE deleted_at IS NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_inbody_pending_tenant_uploaded
            ON inbody_pending (tenant_id, uploaded_at DESC)
            WHERE deleted_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_inbody_pending_tenant_uploaded;")
    op.execute("DROP INDEX IF EXISTS idx_inbody_records_tenant_measured;")
