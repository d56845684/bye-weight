BEGIN;

DELETE FROM action_mappings am
USING services s
WHERE am.service_id = s.id
  AND s.name = 'admin'
  AND am.http_method = 'POST'
  AND am.url_pattern = '/auth/v1/admin/users/{id}/google-binding-token';

COMMIT;
