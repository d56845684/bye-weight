BEGIN;

DROP INDEX IF EXISTS idx_policies_tenant;

ALTER TABLE policies
    DROP COLUMN IF EXISTS tenant_id;

COMMIT;
