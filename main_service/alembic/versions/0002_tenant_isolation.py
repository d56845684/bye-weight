"""tenant isolation + auth_user_id

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 所有業務表都加 tenant_id，對應 auth_db.tenants.id
# tenant_id=0 保留給 system tenant（super_admin 用）
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
    for table in TENANT_TABLES:
        op.add_column(
            table,
            sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index(f"idx_{table}_tenant", table, ["tenant_id"])

    # patients 綁 auth_db.users.id（UNIQUE；nullable 先暫留，等實際資料填回後再緊縮）
    op.add_column(
        "patients",
        sa.Column("auth_user_id", sa.Integer(), nullable=True),
    )
    op.create_unique_constraint("uq_patients_auth_user", "patients", ["auth_user_id"])
    op.create_index("idx_patients_auth_user", "patients", ["auth_user_id"])


def downgrade() -> None:
    op.drop_index("idx_patients_auth_user", table_name="patients")
    op.drop_constraint("uq_patients_auth_user", "patients", type_="unique")
    op.drop_column("patients", "auth_user_id")

    for table in reversed(TENANT_TABLES):
        op.drop_index(f"idx_{table}_tenant", table_name=table)
        op.drop_column(table, "tenant_id")
