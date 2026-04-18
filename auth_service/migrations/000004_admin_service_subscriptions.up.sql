-- auth_db: 租戶訂閱服務 / 角色 + 把管理後台提升為獨立 admin service
--
-- 核心概念：
--   tenant_services  — 這個 tenant 能用哪些下游 service（沒訂 → engine 層 403）
--   tenant_roles     — 這個 tenant 可以建哪些角色的 user
--   admin service    — 取代 auth + frontend 舊有的 admin URL mappings，統一命名空間
--
-- 新增 tenant 時由 handler 層 seed 預設訂閱（不在這裡做，這裡只處理既有 system tenant）。

BEGIN;

-- 1. 訂閱表：tenant ↔ service
CREATE TABLE tenant_services (
    tenant_id  INT NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
    service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (tenant_id, service_id)
);
CREATE INDEX idx_tenant_services_tenant ON tenant_services(tenant_id);

-- 2. 訂閱表：tenant ↔ role（可發哪些角色給 user）
CREATE TABLE tenant_roles (
    tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role_id    INT NOT NULL REFERENCES roles(id)   ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (tenant_id, role_id)
);
CREATE INDEX idx_tenant_roles_tenant ON tenant_roles(tenant_id);

-- 3. 新增 admin service（管理後台）
INSERT INTO services (name, prefix) VALUES ('admin', '')
ON CONFLICT (name) DO NOTHING;

-- 4. 清掉原本放在 auth / frontend service 底下的 admin action_mappings
DELETE FROM action_mappings
 WHERE service_id IN (
    SELECT id FROM services WHERE name IN ('auth', 'frontend')
 );

-- 5. 重新把所有 admin 相關 URL 放到 admin service，統一 admin:* action namespace
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    -- 後台 SPA 頁面進入閘門（Nginx 對 /admin/* 做 auth_request）
    ('GET',    '/admin/*',                                   'admin:view',        'admin:page'),

    -- tenants
    ('GET',    '/auth/v1/admin/tenants',                        'admin:tenant:read',  'admin:tenant/*'),
    ('POST',   '/auth/v1/admin/tenants',                        'admin:tenant:write', 'admin:tenant'),
    ('GET',    '/auth/v1/admin/tenants/{id}',                   'admin:tenant:read',  'admin:tenant/${path.id}'),
    ('PATCH',  '/auth/v1/admin/tenants/{id}',                   'admin:tenant:write', 'admin:tenant/${path.id}'),
    ('DELETE', '/auth/v1/admin/tenants/{id}',                   'admin:tenant:write', 'admin:tenant/${path.id}'),
    ('GET',    '/auth/v1/admin/tenants/{id}/services',          'admin:tenant:read',  'admin:tenant/${path.id}/services'),
    ('PUT',    '/auth/v1/admin/tenants/{id}/services',          'admin:tenant:write', 'admin:tenant/${path.id}/services'),
    ('GET',    '/auth/v1/admin/tenants/{id}/roles',             'admin:tenant:read',  'admin:tenant/${path.id}/roles'),
    ('PUT',    '/auth/v1/admin/tenants/{id}/roles',             'admin:tenant:write', 'admin:tenant/${path.id}/roles'),

    -- users
    ('GET',    '/auth/v1/admin/users',                          'admin:user:read',   'admin:user/*'),
    ('POST',   '/auth/v1/admin/users',                          'admin:user:write',  'admin:user'),
    ('PATCH',  '/auth/v1/admin/users/{id}',                     'admin:user:write',  'admin:user/${path.id}'),
    ('POST',   '/auth/v1/admin/users/{id}/binding-token',       'admin:user:write',  'admin:user/${path.id}'),

    -- roles
    ('GET',    '/auth/v1/admin/roles',                          'admin:role:read',   'admin:role/*'),
    ('POST',   '/auth/v1/admin/roles',                          'admin:role:write',  'admin:role'),
    ('DELETE', '/auth/v1/admin/roles/{id}',                     'admin:role:write',  'admin:role/${path.id}'),
    ('GET',    '/auth/v1/admin/roles/{id}/policies',            'admin:role:read',   'admin:role/${path.id}'),
    ('PUT',    '/auth/v1/admin/roles/{id}/policies',            'admin:role:write',  'admin:role/${path.id}'),

    -- policies + services 唯讀列表
    ('GET',    '/auth/v1/admin/policies',                       'admin:policy:read', 'admin:policy/*'),
    ('GET',    '/auth/v1/admin/services',                       'admin:service:read','admin:service/*')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'admin';

-- 6. system tenant（id=0）訂閱所有現有 services 與所有 roles
INSERT INTO tenant_services (tenant_id, service_id)
SELECT 0, id FROM services
ON CONFLICT DO NOTHING;

INSERT INTO tenant_roles (tenant_id, role_id)
SELECT 0, id FROM roles
ON CONFLICT DO NOTHING;

COMMIT;
