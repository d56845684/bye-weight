-- 還原到 000014 的 admin:user:read / write 字面列舉

BEGIN;

UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,1,actions}',
    '["admin:user:read", "admin:user:write"]'::jsonb
)
WHERE name = 'clinic-admin';

COMMIT;
