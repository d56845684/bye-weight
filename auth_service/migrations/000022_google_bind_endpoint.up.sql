-- 登記 Google 綁定的 admin endpoint：
--   POST /auth/admin/users/{id}/google-binding-token  產一次性 Google 綁定 token
--
-- 其他 google 端點不需要登記：
--   POST /auth/google         (nginx 走 /auth/v1/，非 /auth/v1/admin/，不吃 auth_request)
--   POST /auth/google-bind    同上，public endpoint

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'POST', '/auth/v1/admin/users/{id}/google-binding-token',
       'admin:user:write', 'admin:tenant/${auth:tenant_id}/user/${path.id}'
FROM services s
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
