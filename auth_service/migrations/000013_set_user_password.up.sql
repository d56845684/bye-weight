-- 註冊 POST /auth/v1/admin/users/{id}/password 的 action_mapping。
-- resource 走 tenant-scoped 命名，讓 clinic-admin 能改自己 tenant 的 user
-- 密碼（super-admin-all 天然透過 wildcard 匹配）。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'POST', '/auth/v1/admin/users/{id}/password',
       'admin:user:write', 'admin:tenant/${auth:tenant_id}/user/${path.id}'
FROM services s
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
