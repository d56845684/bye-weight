BEGIN;

DELETE FROM action_mappings
 WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
   AND http_method = 'POST'
   AND url_pattern = '/auth/v1/admin/users/{id}/password';

COMMIT;
