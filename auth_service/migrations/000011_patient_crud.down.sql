BEGIN;

DELETE FROM action_mappings
 WHERE service_id = (SELECT id FROM services WHERE name = 'main')
   AND (http_method, url_pattern) IN (
       ('POST',   '/patients'),
       ('PATCH',  '/patients/{id}'),
       ('DELETE', '/patients/{id}')
   );

-- 把 main:patient:write 從 staff-clinic-ops 拔掉
UPDATE policies
SET document = jsonb_set(
    document,
    '{statements,0,actions}',
    (
        SELECT jsonb_agg(a)
        FROM jsonb_array_elements(document->'statements'->0->'actions') AS a
        WHERE a::text <> '"main:patient:write"'
    )
)
WHERE name = 'staff-clinic-ops';

COMMIT;
