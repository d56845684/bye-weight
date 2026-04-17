-- auth_db: 新增 super_admin 角色與管理權限
-- super_admin 專門管理整個系統（跨診所、user/role 管理）
-- admin 只剩診所內病患管理權限（綁 same_clinic_only PBAC）

BEGIN;

-- ── 新角色 ───────────────────────────────────────
INSERT INTO roles (name) VALUES ('super_admin')
ON CONFLICT (name) DO NOTHING;

-- ── 新 permissions（管理後台）──────────────────
INSERT INTO permissions (name, resource, action, url_pattern, http_method) VALUES
    ('admin:access',  'admin',  'access', '/admin',              'GET'),
    ('user:read',     'user',   'read',   '/auth/admin/users',   'GET'),
    ('user:write',    'user',   'write',  '/auth/admin/users',   'POST'),
    ('role:assign',   'role',   'assign', '/auth/admin/users',   'PATCH'),
    ('clinic:manage', 'clinic', 'manage', '/api/clinics',        'GET')
ON CONFLICT (name) DO NOTHING;

-- ── super_admin 獲得所有 permissions（含新增與既有）──
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- ── 安全起見：把新增的管理 permission 從 admin 撤回 ──
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'admin')
  AND permission_id IN (
    SELECT id FROM permissions
    WHERE name IN ('admin:access', 'user:read', 'user:write', 'role:assign', 'clinic:manage')
  );

-- ── admin 的 patient:manage 綁 same_clinic_only（限診所範圍） ──
INSERT INTO permission_policies (permission_id, policy_id)
SELECT p.id, pol.id
FROM permissions p, policies pol
WHERE p.name = 'patient:manage' AND pol.name = 'same_clinic_only'
ON CONFLICT DO NOTHING;

-- ── 把 dev-admin 從 admin 升級為 super_admin ──
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'super_admin')
WHERE line_uuid = 'dev-admin';

COMMIT;
