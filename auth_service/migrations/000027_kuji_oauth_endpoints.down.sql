BEGIN;

DELETE FROM action_mappings
WHERE service_id = (SELECT id FROM services WHERE name = 'kuji')
  AND url_pattern IN (
    '/integrations/{kind}/connect',
    '/integrations/{kind}/resources/{type}',
    '/integrations/{kind}/disconnect',
    '/integrations/{kind}'
  );

COMMIT;
