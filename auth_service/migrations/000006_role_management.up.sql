-- auth_db: 後台角色管理相關 permissions
-- 提供 super_admin 透過後台管理 roles / role-permission 配對

BEGIN;

INSERT INTO permissions (name, resource, action, url_pattern, http_method) VALUES
    ('role:list',       'role',       'list',   '/auth/admin/roles',       'GET'),
    ('role:create',     'role',       'create', '/auth/admin/roles',       'POST'),
    ('role:update',     'role',       'update', '/auth/admin/roles',       'PUT'),
    ('role:delete',     'role',       'delete', '/auth/admin/roles',       'DELETE'),
    ('permission:list', 'permission', 'list',   '/auth/admin/permissions', 'GET')
ON CONFLICT (name) DO NOTHING;

-- super_admin 把新增的 permissions 也收起來
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

COMMIT;
