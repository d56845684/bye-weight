BEGIN;

DELETE FROM action_mappings
 WHERE action IN ('admin:policy:read', 'admin:policy:write')
   AND service_id = (SELECT id FROM services WHERE name = 'admin')
   AND url_pattern = '/auth/v1/admin/policies/{id}';

COMMIT;
