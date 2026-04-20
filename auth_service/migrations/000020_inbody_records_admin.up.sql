-- 登記 main_service 新的 admin inbody records list：
--   GET /inbody/records      列出同 tenant 全部 inbody_records（super_admin + all_tenants 可跨租戶）
--
-- Resource 用 tenant-scoped `inbody-records`（不是 /user/{uid}/ 個人層級），
-- patient-self-access 天然比對不上 → 擋下；admin / staff / nutritionist 透過
-- main:tenant/{tid}/* + main:inbody:* 涵蓋，不用動 policy。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'GET', '/inbody/records', 'main:inbody:read', 'main:tenant/${auth:tenant_id}/inbody-records'
FROM services s
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

COMMIT;
