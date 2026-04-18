-- 註冊 admin:user:write action 給 POST /auth/v1/admin/users/{id}/unbind 使用。
-- Unbind 會同時清 line_uuid 並將 active 設為 false，讓手機上的 session 下一個
-- request 就被 verify 擋下。super_admin 原有 policy 就能涵蓋這個 resource。
-- Additive migration，可獨立上線。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'POST', '/auth/v1/admin/users/{id}/unbind', 'admin:user:write', 'admin:user/${path.id}'
FROM services s
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
