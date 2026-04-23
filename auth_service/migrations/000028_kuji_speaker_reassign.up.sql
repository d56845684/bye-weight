-- auth_db: 擴 kuji action_mappings — meeting speaker 手動重指派。
-- policy kuji-user-policy 已經涵蓋 kuji:meeting:write on kuji:tenant/${auth:tenant_id}/*
-- 所以只要加 mapping 就行。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'PATCH', '/meetings/{id}/speakers/{speaker_id}',
       'kuji:meeting:write',
       'kuji:tenant/${auth:tenant_id}/meeting/${path.id}/speaker/${path.speaker_id}'
FROM services s
WHERE s.name = 'kuji'
ON CONFLICT DO NOTHING;

COMMIT;
