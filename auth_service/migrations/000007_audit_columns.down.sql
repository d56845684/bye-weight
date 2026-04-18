BEGIN;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'tenants', 'services', 'action_mappings', 'policies', 'roles']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
        EXECUTE format(
            'ALTER TABLE %I
                 DROP COLUMN IF EXISTS deleted_by,
                 DROP COLUMN IF EXISTS deleted_at,
                 DROP COLUMN IF EXISTS updated_by,
                 DROP COLUMN IF EXISTS updated_at,
                 DROP COLUMN IF EXISTS created_by', t);
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS audit_autofill();

COMMIT;
