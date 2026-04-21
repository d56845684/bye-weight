"""inbody_records extended fields + patient_goals history table

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-21

Phase 3 補 Direction B 設計上看得到、現在 schema 還沒承接的欄位。

---

inbody_records：
  body_age           INT NULL      身體年齡（歲）
  total_body_water   NUMERIC(4,1)  體內水分（kg）
  protein_mass       NUMERIC(4,1)  蛋白質（kg）
  mineral_mass       NUMERIC(4,1)  無機鹽（kg）
  muscle_segmental   JSONB NULL    {la, ra, tr, ll, rl}（左右臂 / 軀幹 / 左右腿 肌肉 kg）
  fat_segmental      JSONB NULL    同上結構（脂肪 kg）

Segmental 用 JSONB 而非拆五欄：
  - InBody 機器輸出是整包結構化資料，JSON 自然
  - 未來要加「分部位體水 / 蛋白」等不用 ALTER TABLE
  - 只 display 不 aggregate，不需要獨立 index

全部 NULLABLE；舊 row 不補（InBody 重跑 OCR 才能填）。

---

patient_goals (新表) —— 目標變更歷史（append-only，never UPDATE）：
  每次營養師諮詢調整目標都 INSERT 一筆新 row，舊 row 留作歷史。
  「當前目標」 = 最近一筆 effective_from <= today 且 deleted_at IS NULL，
  查詢時 ORDER BY effective_from DESC LIMIT 1。

  歷史 row 拿來：
    - 稽核（誰在什麼時候把目標改成多少）
    - 未來 UI 顯示目標變動曲線（疊在體重 / kcal 趨勢圖上）

  一張表涵蓋 InBody + 食物兩邊的目標（整體是一個「目標快照」），
  這樣一次調整就是一次 snapshot，不用拆兩張表 JOIN。

  id                 BIGSERIAL
  patient_id         INT NOT NULL
  tenant_id          INT NOT NULL (defense-in-depth，可繞 RLS 時兜底)
  -- InBody 相關
  target_weight      NUMERIC(5,1) NULL 目標體重（kg）
  target_body_fat    NUMERIC(4,1) NULL 目標體脂（%）
  -- 食物相關
  daily_kcal         INT NULL          每日熱量（kcal）
  target_carbs_pct   NUMERIC(4,1) NULL 目標碳水 %
  target_protein_pct NUMERIC(4,1) NULL 目標蛋白 %
  target_fat_pct     NUMERIC(4,1) NULL 目標脂肪 %
  -- meta
  effective_from     DATE NOT NULL     生效日
  set_by             INT               營養師 user_id（非 FK，auth_db 跨庫）
  notes              TEXT              營養師備註
  + audit columns

  Index: (patient_id, effective_from DESC) WHERE deleted_at IS NULL
        — 支援「當前目標」lookup O(log n)。
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # inbody_records 擴充
    op.execute(
        """
        ALTER TABLE inbody_records
            ADD COLUMN IF NOT EXISTS body_age         INT,
            ADD COLUMN IF NOT EXISTS total_body_water NUMERIC(4,1),
            ADD COLUMN IF NOT EXISTS protein_mass     NUMERIC(4,1),
            ADD COLUMN IF NOT EXISTS mineral_mass     NUMERIC(4,1),
            ADD COLUMN IF NOT EXISTS muscle_segmental JSONB,
            ADD COLUMN IF NOT EXISTS fat_segmental    JSONB;
        """
    )

    # patient_goals 新表
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS patient_goals (
            id                 BIGSERIAL PRIMARY KEY,
            patient_id         INT NOT NULL,
            tenant_id          INT NOT NULL DEFAULT 0,
            -- InBody 目標
            target_weight      NUMERIC(5,1),
            target_body_fat    NUMERIC(4,1),
            -- 食物目標
            daily_kcal         INT,
            target_carbs_pct   NUMERIC(4,1),
            target_protein_pct NUMERIC(4,1),
            target_fat_pct     NUMERIC(4,1),
            -- meta
            effective_from     DATE NOT NULL DEFAULT CURRENT_DATE,
            set_by             INT,
            notes              TEXT,
            created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
            created_by         INT,
            updated_at         TIMESTAMP,
            updated_by         INT,
            deleted_at         TIMESTAMP,
            deleted_by         INT
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_patient_goals_patient_effective
            ON patient_goals (patient_id, effective_from DESC)
            WHERE deleted_at IS NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_patient_goals_tenant
            ON patient_goals (tenant_id)
            WHERE deleted_at IS NULL;
        """
    )
    # 稽核 trigger（同既有 pattern）
    op.execute(
        """
        CREATE TRIGGER trg_patient_goals_audit
            BEFORE INSERT OR UPDATE ON patient_goals
            FOR EACH ROW EXECUTE FUNCTION audit_autofill();
        """
    )
    # RLS — 對齊其他業務表（0003 pattern）
    op.execute(
        """
        ALTER TABLE patient_goals ENABLE ROW LEVEL SECURITY;
        ALTER TABLE patient_goals FORCE ROW LEVEL SECURITY;
        """
    )
    op.execute(
        """
        CREATE POLICY tenant_isolation ON patient_goals
            USING (
                tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::INTEGER
                OR current_setting('app.bypass_rls', true) = 'true'
            )
            WITH CHECK (
                tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::INTEGER
                OR current_setting('app.bypass_rls', true) = 'true'
            );
        """
    )
    op.execute(
        """
        GRANT SELECT, INSERT, UPDATE, DELETE ON patient_goals TO app_user;
        GRANT USAGE, SELECT ON SEQUENCE patient_goals_id_seq TO app_user;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS patient_goals;")
    op.execute(
        """
        ALTER TABLE inbody_records
            DROP COLUMN IF EXISTS body_age,
            DROP COLUMN IF EXISTS total_body_water,
            DROP COLUMN IF EXISTS protein_mass,
            DROP COLUMN IF EXISTS mineral_mass,
            DROP COLUMN IF EXISTS muscle_segmental,
            DROP COLUMN IF EXISTS fat_segmental;
        """
    )
