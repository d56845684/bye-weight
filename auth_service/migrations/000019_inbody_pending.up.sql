-- 登記 main_service 新加的 inbody_pending 人工處理 endpoints：
--   GET   /inbody/pending                    列出同 tenant 待處理
--   POST  /inbody/pending/{id}/resolve       指派給某個 patient（產生 inbody_records）
--   POST  /inbody/pending/{id}/discard       丟棄
--
-- Resource 使用 tenant-scoped `inbody-pending`（不是 /user/{uid}/ 那種個人範圍），
-- 這樣：
--   - patient-self-access（resource=main:tenant/{tid}/user/{uid}/*）天然比對不上 → 擋下
--   - staff-clinic-ops / nutritionist-ops / clinic-admin（resource=main:tenant/{tid}/*）
--     天然涵蓋，不用動 policy（因為 action 也在既有的 main:inbody:* wildcard 裡）

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',  '/inbody/pending',                'main:inbody:read',  'main:tenant/${auth:tenant_id}/inbody-pending'),
    ('POST', '/inbody/pending/{id}/resolve',   'main:inbody:write', 'main:tenant/${auth:tenant_id}/inbody-pending/${path.id}'),
    ('POST', '/inbody/pending/{id}/discard',   'main:inbody:write', 'main:tenant/${auth:tenant_id}/inbody-pending/${path.id}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

COMMIT;
