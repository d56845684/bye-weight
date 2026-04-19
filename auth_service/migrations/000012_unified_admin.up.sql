-- 統一管理後台：
--   (1) admin:user action_mappings 的 resource_template 改成 tenant-scoped ARN，
--       讓 clinic-admin 能用 "admin:tenant/${auth:tenant_id}/user/*" 政策限縮。
--   (2) 所有 tenant 自動訂閱 admin service（系統 tenant 原本就訂；其他 tenant
--       新訂以便 clinic-admin 能進 /admin/*）。
--   (3) 在 defaultTenantServices 觀念上新 tenant 預設訂 admin；這裡先補既有 tenant。
--   (4) staff-clinic-ops / nutritionist-ops 政策加 admin:view（能進後台頁面）。
--   (5) clinic-admin 政策重寫：原本的 main:* 保留，再加 admin:view + admin:user:*
--       限縮到自己 tenant。

BEGIN;

-- (1) admin:user action_mappings resource template 加 tenant prefix
UPDATE action_mappings
SET resource_template = 'admin:tenant/${auth:tenant_id}/user/*'
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND http_method = 'GET'
  AND url_pattern = '/auth/v1/admin/users';

UPDATE action_mappings
SET resource_template = 'admin:tenant/${auth:tenant_id}/user'
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND http_method = 'POST'
  AND url_pattern = '/auth/v1/admin/users';

UPDATE action_mappings
SET resource_template = 'admin:tenant/${auth:tenant_id}/user/${path.id}'
WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
  AND url_pattern IN (
    '/auth/v1/admin/users/{id}',
    '/auth/v1/admin/users/{id}/binding-token',
    '/auth/v1/admin/users/{id}/unbind'
  );

-- (2) 所有既有 tenant 訂 admin service（防 duplicate 用 ON CONFLICT）
INSERT INTO tenant_services (tenant_id, service_id)
SELECT t.id, s.id
FROM tenants t, services s
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

-- (4) staff-clinic-ops / nutritionist-ops：加 admin:view 到 actions
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('admin:view'::text)
)
WHERE name IN ('staff-clinic-ops', 'nutritionist-ops')
  AND NOT (document->'statements'->0->'actions' @> '"admin:view"'::jsonb);

-- 順手把 admin:page resource 加進 resources 清單
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,resources}',
    (document->'statements'->0->'resources') || to_jsonb('admin:page'::text)
)
WHERE name IN ('staff-clinic-ops', 'nutritionist-ops')
  AND NOT (document->'statements'->0->'resources' @> '"admin:page"'::jsonb);

-- (5) clinic-admin 政策重寫：原本的 main:* 全保留 + 新增 admin:view / admin:user:* 的 statement
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
        "main:upload:write",
        "admin:view"
      ],
      "resources": [
        "main:tenant/${auth:tenant_id}/*",
        "admin:page"
      ]
    },
    {
      "effect": "allow",
      "actions": ["admin:user:read", "admin:user:write"],
      "resources": [
        "admin:tenant/${auth:tenant_id}/user",
        "admin:tenant/${auth:tenant_id}/user/*"
      ]
    }
  ]
}'::jsonb
WHERE name = 'clinic-admin';

COMMIT;
