-- 登記 admin 病患 detail aggregator endpoint：
--   GET /patients/{id}/detail    一次取 profile + goals + inbody / food / visits 歷史
--
-- Resource = main:tenant/{tid}/patient/{id}：
--   - clinic-admin 的 main:patient:* + main:tenant/{tid}/* 涵蓋
--   - patient-self-access 的 resource 是 main:tenant/{tid}/user/{uid}/*，不會 match
--     → 病患不能拿別人的 detail

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'GET', '/patients/{id}/detail',
       'main:patient:read', 'main:tenant/${auth:tenant_id}/patient/${path.id}'
FROM services s
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

COMMIT;
