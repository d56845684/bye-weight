-- 還原 000012：action_mappings 回非 tenant-scoped、policies 回復 admin:view 之前

BEGIN;

-- (1) 還原 admin:user action_mappings 的 resource_template
UPDATE action_mappings
SET resource_template = 'auth:user/*'
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND http_method = 'GET'
  AND url_pattern = '/auth/v1/admin/users';

UPDATE action_mappings
SET resource_template = 'auth:user'
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND http_method = 'POST'
  AND url_pattern = '/auth/v1/admin/users';

UPDATE action_mappings
SET resource_template = 'auth:user/${path.id}'
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND url_pattern IN (
    '/auth/v1/admin/users/{id}',
    '/auth/v1/admin/users/{id}/binding-token',
    '/auth/v1/admin/users/{id}/unbind'
  );

-- (2) 拿掉所有非 system tenant 的 admin 訂閱
DELETE FROM tenant_services
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND tenant_id != 0;

-- (4) staff-clinic-ops / nutritionist-ops 拔 admin:view / admin:page
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (
        SELECT jsonb_agg(a)
        FROM jsonb_array_elements(document->'statements'->0->'actions') AS a
        WHERE a::text <> '"admin:view"'
    )
)
WHERE name IN ('staff-clinic-ops', 'nutritionist-ops');

UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,resources}',
    (
        SELECT jsonb_agg(a)
        FROM jsonb_array_elements(document->'statements'->0->'resources') AS a
        WHERE a::text <> '"admin:page"'
    )
)
WHERE name IN ('staff-clinic-ops', 'nutritionist-ops');

-- (5) 還原 clinic-admin 政策
UPDATE policies
SET document = '{
    "statements": [
        {
            "effect": "allow",
            "actions": [
                "main:patient:*",
                "main:inbody:*",
                "main:food_log:*",
                "main:visit:*",
                "main:notification:*",
                "main:push:*",
                "main:upload:write"
            ],
            "resources": ["main:tenant/${auth:tenant_id}/*"]
        }
    ]
}'::jsonb
WHERE name = 'clinic-admin';

COMMIT;
