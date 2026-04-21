BEGIN;

-- Action mappings
DELETE FROM action_mappings am
USING services s
WHERE am.service_id = s.id
  AND s.name = 'main'
  AND (
    (am.http_method = 'POST' AND am.url_pattern = '/patient-goals')
 OR (am.http_method = 'GET'  AND am.url_pattern = '/patient-goals')
 OR (am.http_method = 'GET'  AND am.url_pattern = '/food-logs/records')
 OR (am.http_method = 'GET'  AND am.url_pattern = '/visits/records')
  );

-- Policy rollback：從 actions array 移除 main:goal:*。
-- jsonb-array 移除元素：重建 array。
UPDATE policies
SET document = jsonb_set(
    document, '{statements,0,actions}',
    (
        SELECT jsonb_agg(v)
        FROM jsonb_array_elements_text(document->'statements'->0->'actions') AS t(v)
        WHERE v NOT IN ('main:goal:*', 'main:goal:read', 'main:goal:write')
    )
)
WHERE name IN ('clinic-admin', 'nutritionist-ops', 'staff-clinic-ops');

COMMIT;
