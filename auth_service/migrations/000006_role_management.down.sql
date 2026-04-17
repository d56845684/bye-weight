BEGIN;

DELETE FROM permissions WHERE name IN
    ('role:list', 'role:create', 'role:update', 'role:delete', 'permission:list');

COMMIT;
