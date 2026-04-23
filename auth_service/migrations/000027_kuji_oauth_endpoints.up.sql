-- auth_db: 擴 kuji action_mappings 以涵蓋 provider list + OAuth endpoints。

BEGIN;

INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',    '/integrations/providers',
     'kuji:integration:read',  'kuji:tenant/${auth:tenant_id}/integration/*'),
    ('GET',    '/integrations/{kind}/connect',
     'kuji:integration:write', 'kuji:tenant/${auth:tenant_id}/integration/${path.kind}'),
    ('GET',    '/integrations/{kind}/resources/{type}',
     'kuji:integration:read',  'kuji:tenant/${auth:tenant_id}/integration/${path.kind}'),
    ('POST',   '/integrations/{kind}/disconnect',
     'kuji:integration:write', 'kuji:tenant/${auth:tenant_id}/integration/${path.kind}'),
    ('PUT',    '/integrations/{kind}',
     'kuji:integration:write', 'kuji:tenant/${auth:tenant_id}/integration/${path.kind}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'kuji'
ON CONFLICT DO NOTHING;

COMMIT;
