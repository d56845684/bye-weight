-- 註冊 admin:cache:invalidate action 給 POST /auth/v1/admin/invalidate 使用。
-- 這是 additive migration，可獨立上線，不影響既有功能。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'POST', '/auth/v1/admin/invalidate', 'admin:cache:invalidate', 'admin:cache'
FROM services s
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
