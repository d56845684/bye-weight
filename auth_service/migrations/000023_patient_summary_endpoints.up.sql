-- 登記 main_service 新的病患 dashboard summary endpoints：
--   GET /inbody/me/summary       最新一筆 + 30 天 series
--   GET /food-logs/me/summary    今日餐點 + 30 天 kcal/macros 序列
--   GET /visits/me/timeline      看診紀錄 + upcoming 標記
--
-- Resource 沿用既有「病患自己專屬」pattern：main:tenant/{tid}/user/{uid}/{資源}
-- patient-self-access policy 的 resource wildcard 已涵蓋這些路徑，不用動 policy。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET', '/inbody/me/summary',
     'main:inbody:read',    'main:tenant/${auth:tenant_id}/user/${auth:user_id}/inbody'),
    ('GET', '/food-logs/me/summary',
     'main:food_log:read',  'main:tenant/${auth:tenant_id}/user/${auth:user_id}/food_log'),
    ('GET', '/visits/me/timeline',
     'main:visit:read',     'main:tenant/${auth:tenant_id}/user/${auth:user_id}/visit')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

COMMIT;
