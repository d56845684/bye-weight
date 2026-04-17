BEGIN;

DELETE FROM permission_policies;
DELETE FROM policy_conditions;
DELETE FROM policies;
DELETE FROM role_permissions;
DELETE FROM permissions;
DELETE FROM roles;

COMMIT;
