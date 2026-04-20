-- 註冊 DELETE /auth/v1/admin/users/{id} 的 action_mapping
-- 軟刪除 user：updated by handler/admin_users.go DeleteUser
-- super-admin-all policy 已涵蓋 admin:user:write（*:* wildcard）

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'DELETE', '/auth/v1/admin/users/{id}', 'admin:user:write', 'admin:user/${path.id}'
FROM services s
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
