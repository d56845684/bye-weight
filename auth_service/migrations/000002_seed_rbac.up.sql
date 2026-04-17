-- auth_db: 初始 RBAC 種子資料

BEGIN;

-- 角色
INSERT INTO roles (name) VALUES ('patient'), ('staff'), ('nutritionist'), ('admin')
ON CONFLICT (name) DO NOTHING;

-- 權限（含 URL 路由映射）
INSERT INTO permissions (name, resource, action, url_pattern, http_method) VALUES
    ('inbody:read',        'inbody',        'read',   '/inbody',        'GET'),
    ('inbody:write',       'inbody',        'write',  '/inbody',        'POST'),
    ('food_log:read',      'food_log',      'read',   '/food-logs',     'GET'),
    ('food_log:write',     'food_log',      'write',  '/food-logs',     'POST'),
    ('visit:read',         'visit',         'read',   '/visits',        'GET'),
    ('visit:write',        'visit',         'write',  '/visits',        'POST'),
    ('notification:read',  'notification',  'read',   '/notifications', 'GET'),
    ('notification:write', 'notification',  'write',  '/notifications', 'PATCH'),
    ('push:send',          'push',          'send',   '/notify',        'POST'),
    ('patient:manage',     'patient',       'manage', '/patients',      'GET'),
    ('upload:write',       'upload',        'write',  '/upload',        'POST')
ON CONFLICT (name) DO NOTHING;

-- patient 權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'patient' AND p.name IN (
    'inbody:read', 'food_log:read', 'food_log:write',
    'visit:read', 'notification:read', 'upload:write'
)
ON CONFLICT DO NOTHING;

-- staff 權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'staff' AND p.name IN (
    'inbody:read', 'inbody:write', 'food_log:read',
    'visit:read', 'visit:write', 'notification:read', 'upload:write'
)
ON CONFLICT DO NOTHING;

-- nutritionist 權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nutritionist' AND p.name IN (
    'inbody:read', 'inbody:write', 'food_log:read', 'food_log:write',
    'visit:read', 'visit:write', 'notification:read', 'notification:write',
    'push:send', 'upload:write'
)
ON CONFLICT DO NOTHING;

-- admin: 全部權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- PBAC 策略
INSERT INTO policies (name, effect) VALUES
    ('own_data_only', 'allow'),
    ('same_clinic_only', 'allow')
ON CONFLICT (name) DO NOTHING;

INSERT INTO policy_conditions (policy_id, condition_type, operator, value_config)
SELECT pol.id, 'resource_owner', 'eq',
       '{"subject_field": "patient_id", "resource_field": "patient_id"}'::jsonb
FROM policies pol WHERE pol.name = 'own_data_only'
AND NOT EXISTS (
    SELECT 1 FROM policy_conditions pc
    WHERE pc.policy_id = pol.id AND pc.condition_type = 'resource_owner'
);

INSERT INTO policy_conditions (policy_id, condition_type, operator, value_config)
SELECT pol.id, 'clinic_scope', 'eq',
       '{"subject_field": "clinic_id", "resource_field": "clinic_id"}'::jsonb
FROM policies pol WHERE pol.name = 'same_clinic_only'
AND NOT EXISTS (
    SELECT 1 FROM policy_conditions pc
    WHERE pc.policy_id = pol.id AND pc.condition_type = 'clinic_scope'
);

-- patient 讀取權限綁定 resource_owner
INSERT INTO permission_policies (permission_id, policy_id)
SELECT p.id, pol.id FROM permissions p, policies pol
WHERE p.name IN ('inbody:read', 'food_log:read', 'visit:read', 'notification:read')
  AND pol.name = 'own_data_only'
ON CONFLICT DO NOTHING;

COMMIT;
