BEGIN;

-- Action mappings
DELETE FROM action_mappings am
USING services s
WHERE am.service_id = s.id
  AND s.name = 'main'
  AND (
    (am.http_method = 'POST' AND am.url_pattern = '/blood-test-reports/sync')
 OR (am.http_method = 'GET'  AND am.url_pattern = '/blood-test-reports/records')
 OR (am.http_method = 'GET'  AND am.url_pattern = '/blood-test-reports')
  );

-- Policy rollback：從 actions array 移除 blood_test_report 相關 action（重建 array）。
UPDATE policies
SET document = jsonb_set(
    document, '{statements,0,actions}',
    (
        SELECT jsonb_agg(v)
        FROM jsonb_array_elements_text(document->'statements'->0->'actions') AS t(v)
        WHERE v NOT IN ('main:blood_test_report:*', 'main:blood_test_report:read', 'main:blood_test_report:write')
    )
)
WHERE name IN ('clinic-admin', 'nutritionist-ops', 'staff-clinic-ops', 'patient-self-access');

COMMIT;
