-- 登記 main_service 新加的 patient CRUD endpoints：
--   POST   /patients            admin/staff 建立
--   PATCH  /patients/{id}       更新
--   DELETE /patients/{id}       軟刪除（admin only）
--
-- 另外把 main:patient:write 加進 staff 政策，讓 staff 也能建立 / 更新病患，
-- 但 staff 不能刪（用 :delete 細粒度分離）。

BEGIN;

-- 1. 新增 action_mappings
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('POST',   '/patients',        'main:patient:write',  'main:tenant/${auth:tenant_id}/patient'),
    ('PATCH',  '/patients/{id}',   'main:patient:write',  'main:tenant/${auth:tenant_id}/patient/${path.id}'),
    ('DELETE', '/patients/{id}',   'main:patient:delete', 'main:tenant/${auth:tenant_id}/patient/${path.id}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'main'
ON CONFLICT DO NOTHING;

-- 2. staff-clinic-ops 政策加上 main:patient:write（本來只有 read）
-- 保留現有 statement 結構，只對 actions array 做 patch
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (document->'statements'->0->'actions') || to_jsonb('main:patient:write'::text)
)
WHERE name = 'staff-clinic-ops'
  AND NOT (document->'statements'->0->'actions' @> '"main:patient:write"'::jsonb);

-- clinic-admin 已經有 main:patient:* 涵蓋 write + delete；不必改。
-- nutritionist-ops 只留 main:patient:read；不給 write / delete。

COMMIT;
