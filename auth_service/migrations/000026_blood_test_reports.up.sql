-- 登記 main_service 抽血報告 endpoints + 擴 policy：
--   新 action 類別 main:blood_test_report:read / main:blood_test_report:write
--   新 endpoints：
--     POST /blood-test-reports/sync       後台手動觸發 Healthleader 同步（write）
--     GET  /blood-test-reports/records    admin tenant-wide 抽血報告列表（read）
--     GET  /blood-test-reports            病患讀自己的抽血報告（read, self-scoped）
--
-- Resource 設計：
--   /sync、/records 用 main:tenant/${auth:tenant_id}/* 家族（tenant-wide）
--   病患自取用 main:tenant/${tid}/user/${uid}/blood-test-report，patient-self-access 比對得上
--
-- Policy 擴充（對齊 approved plan：staff/nutritionist/admin/super_admin 可同步+檢視，病患讀自己）：
--   clinic-admin       ← main:blood_test_report:*
--   nutritionist-ops   ← main:blood_test_report:*
--   staff-clinic-ops   ← main:blood_test_report:*
--   patient-self-access← main:blood_test_report:read

BEGIN;

-- 1. action_mappings
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('POST', '/blood-test-reports/sync',
     'main:blood_test_report:write', 'main:tenant/${auth:tenant_id}/blood-test-report'),
    ('GET',  '/blood-test-reports/records',
     'main:blood_test_report:read',  'main:tenant/${auth:tenant_id}/blood-test-reports'),
    ('GET',  '/blood-test-reports',
     'main:blood_test_report:read',  'main:tenant/${auth:tenant_id}/user/${auth:user_id}/blood-test-report')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

-- 2. 擴充 policy actions（jsonb array append）

-- clinic-admin: 加 main:blood_test_report:*
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:blood_test_report:*'::text)
)
WHERE name = 'clinic-admin'
  AND NOT (document->'statements'->0->'actions' @> '"main:blood_test_report:*"'::jsonb);

-- nutritionist-ops: 加 main:blood_test_report:*
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:blood_test_report:*'::text)
)
WHERE name = 'nutritionist-ops'
  AND NOT (document->'statements'->0->'actions' @> '"main:blood_test_report:*"'::jsonb);

-- staff-clinic-ops: 加 main:blood_test_report:*
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:blood_test_report:*'::text)
)
WHERE name = 'staff-clinic-ops'
  AND NOT (document->'statements'->0->'actions' @> '"main:blood_test_report:*"'::jsonb);

-- patient-self-access: 加 main:blood_test_report:read
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:blood_test_report:read'::text)
)
WHERE name = 'patient-self-access'
  AND NOT (document->'statements'->0->'actions' @> '"main:blood_test_report:read"'::jsonb);

COMMIT;
