-- Phase 2a：policies 加 tenant_id，為「tenant 自管 policy」鋪路。
-- 現有 policy 自動帶 tenant_id=0（系統級，所有 tenant 共用、只有 super_admin
-- 能改）。非系統 policy 歸某 tenant 擁有（>0）—— 只有該 tenant 的 admin + super_admin
-- 能讀寫；其他 tenant 看不到。
--
-- 此 migration 純 schema 增欄，不動 IAM action_mappings 也不授權
-- clinic-admin 新 actions —— tenant 自管 CRUD endpoints 留給 Phase 2b。

BEGIN;

ALTER TABLE policies
    ADD COLUMN IF NOT EXISTS tenant_id INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies(tenant_id);

COMMIT;
