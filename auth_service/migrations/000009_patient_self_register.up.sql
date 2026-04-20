-- LIFF 首次登入後自建 patient profile 所需的授權配置。
-- 新增：
--   1. 兩筆 action_mapping：GET /patients/me、POST /patients/register
--      resource 以 user_id 做 scope，完美落在 patient-self-access 現有的
--      "main:tenant/${auth:tenant_id}/user/${auth:user_id}/*" 萬用樣式內
--   2. patient-self-access policy：actions 列加入 main:patient:read / main:patient:register
--      （只加不改 resources；idempotent）

BEGIN;

-- 1. action_mappings
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'GET', '/patients/me', 'main:patient:read',
       'main:tenant/${auth:tenant_id}/user/${auth:user_id}/patient'
FROM services s WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'POST', '/patients/register', 'main:patient:register',
       'main:tenant/${auth:tenant_id}/user/${auth:user_id}/patient'
FROM services s WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

-- 2. patient-self-access：把 main:patient:read / main:patient:register 加進 actions
DO $$
DECLARE
    doc jsonb;
    acts jsonb;
BEGIN
    SELECT document INTO doc FROM policies WHERE name = 'patient-self-access';
    IF doc IS NULL THEN
        RAISE NOTICE 'patient-self-access policy not found; skipping';
        RETURN;
    END IF;
    acts := doc -> 'statements' -> 0 -> 'actions';
    IF NOT (acts ? 'main:patient:read') THEN
        acts := acts || '"main:patient:read"'::jsonb;
    END IF;
    IF NOT (acts ? 'main:patient:register') THEN
        acts := acts || '"main:patient:register"'::jsonb;
    END IF;
    doc := jsonb_set(doc, '{statements,0,actions}', acts, false);
    UPDATE policies SET document = doc WHERE name = 'patient-self-access';
END $$;

COMMIT;
