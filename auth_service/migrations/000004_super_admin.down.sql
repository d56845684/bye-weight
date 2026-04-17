BEGIN;

UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE line_uuid = 'dev-admin';

DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'super_admin');

DELETE FROM permission_policies
WHERE permission_id = (SELECT id FROM permissions WHERE name = 'patient:manage')
  AND policy_id     = (SELECT id FROM policies    WHERE name = 'same_clinic_only');

DELETE FROM permissions WHERE name IN
    ('admin:access', 'user:read', 'user:write', 'role:assign', 'clinic:manage');

DELETE FROM roles WHERE name = 'super_admin';

COMMIT;
