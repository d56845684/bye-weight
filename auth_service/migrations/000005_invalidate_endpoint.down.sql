BEGIN;

DELETE FROM action_mappings
 WHERE action = 'admin:cache:invalidate'
   AND service_id = (SELECT id FROM services WHERE name = 'admin');

COMMIT;
