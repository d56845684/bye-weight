"""food_log_images subtable: 1 food_log → N images

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-21

把 food_logs.image_url (單 TEXT) 拆出去，讓一筆飲食紀錄支援多張圖。
子表 food_log_images 預留 caption / position / ai_analysis，將來要對每張圖
做食物辨識 + 卡路里推估時不用再 ALTER。

Backfill：既有非空 image_url 搬成 position=0 的單張圖 row，接著把欄位砍掉。
blob_path 直接沿用舊 image_url 字串（之前存的就是 GCS blob path 或 URL）。

RLS + audit 走既有 pattern（0003 / 0004）：
  - tenant_id NOT NULL，tenant_isolation policy + FORCE ROW LEVEL SECURITY
  - audit 五欄 + trigger audit_autofill
  - app_user 拿 SELECT / INSERT / UPDATE / DELETE + sequence USAGE
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE food_log_images (
            id           SERIAL PRIMARY KEY,
            food_log_id  INTEGER NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
            tenant_id    INTEGER NOT NULL DEFAULT 0,
            blob_path    TEXT    NOT NULL,
            position     INTEGER NOT NULL DEFAULT 0,
            caption      TEXT,
            ai_analysis  JSONB,
            created_at   TIMESTAMP DEFAULT NOW(),
            created_by   INTEGER,
            updated_at   TIMESTAMP,
            updated_by   INTEGER,
            deleted_at   TIMESTAMP,
            deleted_by   INTEGER
        );
        CREATE INDEX idx_food_log_images_log
            ON food_log_images (food_log_id, position)
            WHERE deleted_at IS NULL;
        CREATE INDEX idx_food_log_images_tenant
            ON food_log_images (tenant_id)
            WHERE deleted_at IS NULL;
        """
    )

    op.execute("ALTER TABLE food_log_images ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE food_log_images FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON food_log_images
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
        CREATE TRIGGER trg_food_log_images_audit
            BEFORE INSERT OR UPDATE ON food_log_images
            FOR EACH ROW EXECUTE FUNCTION audit_autofill();
        """
    )

    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON food_log_images TO app_user;"
    )
    op.execute(
        "GRANT USAGE, SELECT ON SEQUENCE food_log_images_id_seq TO app_user;"
    )

    # Backfill：把舊的單張 image_url 搬成 position=0 的 row。
    # Migration 以 postgres superuser 身份跑 → 自動 bypass RLS；bypass_rls 保險用。
    op.execute(
        """
        SET LOCAL app.bypass_rls = 'true';
        INSERT INTO food_log_images (food_log_id, tenant_id, blob_path, position)
        SELECT id, tenant_id, image_url, 0
        FROM food_logs
        WHERE image_url IS NOT NULL
          AND image_url <> ''
          AND deleted_at IS NULL;
        """
    )

    op.execute("ALTER TABLE food_logs DROP COLUMN image_url;")


def downgrade() -> None:
    op.execute("ALTER TABLE food_logs ADD COLUMN image_url TEXT;")
    op.execute(
        """
        SET LOCAL app.bypass_rls = 'true';
        UPDATE food_logs f
        SET image_url = (
            SELECT blob_path
            FROM food_log_images
            WHERE food_log_id = f.id AND deleted_at IS NULL
            ORDER BY position ASC, id ASC
            LIMIT 1
        );
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_food_log_images_audit ON food_log_images;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON food_log_images;")
    op.execute("ALTER TABLE food_log_images DISABLE ROW LEVEL SECURITY;")
    op.execute("DROP TABLE food_log_images;")
