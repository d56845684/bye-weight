BEGIN;

DELETE FROM action_mappings
 WHERE http_method = 'POST'
   AND url_pattern = '/auth/v1/admin/users/{id}/unbind'
   AND service_id = (SELECT id FROM services WHERE name = 'admin');

COMMIT;
