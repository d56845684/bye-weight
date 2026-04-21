-- 登記新 endpoints + 擴 policy：
--   新 action 類別 main:goal:read / main:goal:write
--   新 endpoints：
--     POST /patient-goals                新增目標 snapshot
--     GET  /patient-goals                列目標歷史（tenant 或單一病患）
--     GET  /food-logs/records            admin tenant-wide 飲食列表
--     GET  /visits/records               admin tenant-wide 看診列表
--
-- Resource 皆用 main:tenant/${auth:tenant_id}/* 家族，patient-self-access
-- （main:tenant/{tid}/user/{uid}/*）比對不上 → 病患自然擋下。
--
-- Policy 擴充：
--   clinic-admin       ← 加 main:goal:*
--   nutritionist-ops   ← 加 main:goal:*（nutritionist 是主要設目標者）
--   staff-clinic-ops   ← 加 main:goal:read（staff 僅檢視，不改動）

BEGIN;

-- 1. action_mappings
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('POST', '/patient-goals',
     'main:goal:write', 'main:tenant/${auth:tenant_id}/patient-goal'),
    ('GET',  '/patient-goals',
     'main:goal:read',  'main:tenant/${auth:tenant_id}/patient-goal'),
    ('GET',  '/food-logs/records',
     'main:food_log:read', 'main:tenant/${auth:tenant_id}/food-logs'),
    ('GET',  '/visits/records',
     'main:visit:read',    'main:tenant/${auth:tenant_id}/visits')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

-- 2. 擴充 policy actions（jsonb array append）

-- clinic-admin: 加 main:goal:*
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:goal:*'::text)
)
WHERE name = 'clinic-admin'
  AND NOT (document->'statements'->0->'actions' @> '"main:goal:*"'::jsonb);

-- nutritionist-ops: 加 main:goal:*
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:goal:*'::text)
)
WHERE name = 'nutritionist-ops'
  AND NOT (document->'statements'->0->'actions' @> '"main:goal:*"'::jsonb);

-- staff-clinic-ops: 加 main:goal:read
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:goal:read'::text)
)
WHERE name = 'staff-clinic-ops'
  AND NOT (document->'statements'->0->'actions' @> '"main:goal:read"'::jsonb);

COMMIT;
