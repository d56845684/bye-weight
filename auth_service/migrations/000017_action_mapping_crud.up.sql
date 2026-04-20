-- 註冊 action_mappings CRUD 的 admin endpoints。
-- 四個細粒度 action，方便之後把 read-only 權限授權給 ops / auditor 類角色而
-- 不開放寫入。super-admin-all 的 *:* wildcard 自動涵蓋。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',    '/auth/v1/admin/action-mappings',      'admin:action-mapping:read',   'admin:action-mapping/*'),
    ('POST',   '/auth/v1/admin/action-mappings',      'admin:action-mapping:create', 'admin:action-mapping'),
    ('PATCH',  '/auth/v1/admin/action-mappings/{id}', 'admin:action-mapping:update', 'admin:action-mapping/${path.id}'),
    ('DELETE', '/auth/v1/admin/action-mappings/{id}', 'admin:action-mapping:delete', 'admin:action-mapping/${path.id}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
