"""補齊所有業務表的稽核欄位

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-23

先前遺漏：
  - integration_providers 0005 建表時只有 created_at，缺其他 5 欄 + audit trigger
  - transcript_segments 0001 建表時沒有 created_at（其他 audit 欄是 0003 的 ALTER 補的）

這次一次補齊。審核原則（對齊 CLAUDE.md §資料庫稽核欄位規範）：
  - 會被 UPDATE / soft delete 的表 → 加全部 6 欄 + audit_autofill trigger
  - append-only 短期表（integration_oauth_states）→ 不加，純 insert/delete，tenant 檢查靠 state PK

integration_providers：雖然是近似靜態的 reference 表，但 admin 偶爾會手動調 fields 或停用 provider，
所以歸類到「會被 UPDATE」一側，補上完整稽核欄位。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── transcript_segments 補 created_at ─────────────────
    op.execute("""
        ALTER TABLE transcript_segments
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    """)

    # ── integration_providers 補完整 5 欄 + trigger ───────
    op.execute("""
        ALTER TABLE integration_providers
            ADD COLUMN IF NOT EXISTS created_by INT,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_by INT,
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS deleted_by INT;
    """)
    op.execute("DROP TRIGGER IF EXISTS trg_integration_providers_audit ON integration_providers;")
    op.execute("""
        CREATE TRIGGER trg_integration_providers_audit
            BEFORE INSERT OR UPDATE ON integration_providers
            FOR EACH ROW EXECUTE FUNCTION audit_autofill();
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_integration_providers_not_deleted "
        "ON integration_providers (id) WHERE deleted_at IS NULL;"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_integration_providers_audit ON integration_providers;")
    op.execute("DROP INDEX IF EXISTS idx_integration_providers_not_deleted;")
    op.execute("""
        ALTER TABLE integration_providers
            DROP COLUMN IF EXISTS deleted_by,
            DROP COLUMN IF EXISTS deleted_at,
            DROP COLUMN IF EXISTS updated_by,
            DROP COLUMN IF EXISTS updated_at,
            DROP COLUMN IF EXISTS created_by;
    """)
    op.execute("ALTER TABLE transcript_segments DROP COLUMN IF EXISTS created_at;")
