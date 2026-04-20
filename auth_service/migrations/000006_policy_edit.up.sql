-- 新增 admin:policy:read 對單一 policy 的讀取、admin:policy:write 對 document 的修改
-- super-admin-all policy (*:*) 自動涵蓋，無需改 policies 資料

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',   '/auth/v1/admin/policies/{id}', 'admin:policy:read',  'admin:policy/${path.id}'),
    ('PATCH', '/auth/v1/admin/policies/{id}', 'admin:policy:write', 'admin:policy/${path.id}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
