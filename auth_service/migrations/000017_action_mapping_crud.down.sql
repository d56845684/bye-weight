BEGIN;

DELETE FROM action_mappings
 WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
   AND action IN (
       'admin:action-mapping:read',
       'admin:action-mapping:create',
       'admin:action-mapping:update',
       'admin:action-mapping:delete'
   );

COMMIT;
