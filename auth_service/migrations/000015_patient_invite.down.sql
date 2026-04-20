BEGIN;

DELETE FROM role_policies
 WHERE policy_id = (SELECT id FROM policies WHERE name = 'patient-inviter');

DELETE FROM policies WHERE name = 'patient-inviter';

DELETE FROM action_mappings
 WHERE service_id = (SELECT id FROM services WHERE name = 'admin')
   AND http_method = 'POST'
   AND url_pattern = '/auth/v1/admin/users/invite';

COMMIT;
