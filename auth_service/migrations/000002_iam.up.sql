-- auth_db: IAM 授權層
-- AWS IAM 風格：policy documents (JSONB) + role_policies + services/action_mappings。
-- 所有資源路徑約定：{service}:tenant/${auth:tenant_id}/... 讓 tenant 隔離自動生效。

BEGIN;

-- ── 下游服務註冊 ─────────────────────────────
CREATE TABLE services (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(50) UNIQUE NOT NULL,
    prefix VARCHAR(100) NOT NULL
);

-- ── HTTP 請求 → (action, resource ARN template) 映射 ──
-- url_pattern 用 chi-style：/visits/{id}/medications
-- resource_template 支援 ${auth:user_id} / ${auth:tenant_id} / ${auth:role} / ${path.{name}}
CREATE TABLE action_mappings (
    id                SERIAL PRIMARY KEY,
    service_id        INT REFERENCES services(id) ON DELETE CASCADE,
    http_method       VARCHAR(10) NOT NULL,
    url_pattern       VARCHAR(200) NOT NULL,
    action            VARCHAR(100) NOT NULL,
    resource_template VARCHAR(300) NOT NULL,
    UNIQUE (service_id, http_method, url_pattern)
);
CREATE INDEX idx_action_mappings_service ON action_mappings(service_id);

-- ── Policy document (AWS IAM 風格 JSONB) ────────
-- document schema:
-- {
--   "statements": [
--     { "effect": "allow"|"deny",
--       "actions":   ["main:food_log:*"],
--       "resources": ["main:tenant/${auth:tenant_id}/user/${auth:user_id}/*"],
--       "conditions": { ... }   // optional
--     }
--   ]
-- }
CREATE TABLE policies (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) UNIQUE NOT NULL,
    document   JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ── 角色 ↔ Policy 綁定 ──────────────────────
CREATE TABLE role_policies (
    role_id   INT REFERENCES roles(id) ON DELETE CASCADE,
    policy_id INT REFERENCES policies(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, policy_id)
);

-- ── Seed: 服務 ───────────────────────────────
-- prefix 帶 /v1 代表所有對外 API 的第一版。日後加 v2 = 新建 services row (slug=main_v2, prefix=/api/v2) + 新 action_mappings。
-- frontend 代表前端路由（/admin/*），prefix 空字串讓 pattern 直接當完整路徑比對（頁面路由不版控）。
INSERT INTO services (name, prefix) VALUES
    ('main',     '/api/v1'),
    ('auth',     '/auth/v1'),
    ('frontend', '');

-- ── Seed: main service action mappings ───────
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',    '/inbody/history',            'main:inbody:read',        'main:tenant/${auth:tenant_id}/user/${auth:user_id}/inbody'),
    ('POST',   '/inbody',                    'main:inbody:write',       'main:tenant/${auth:tenant_id}/user/${auth:user_id}/inbody'),
    ('GET',    '/food-logs',                 'main:food_log:read',      'main:tenant/${auth:tenant_id}/user/${auth:user_id}/food_log'),
    ('POST',   '/food-logs',                 'main:food_log:write',     'main:tenant/${auth:tenant_id}/user/${auth:user_id}/food_log'),
    ('GET',    '/visits',                    'main:visit:read',         'main:tenant/${auth:tenant_id}/user/${auth:user_id}/visit'),
    ('POST',   '/visits',                    'main:visit:write',        'main:tenant/${auth:tenant_id}/user/${auth:user_id}/visit'),
    ('GET',    '/visits/{id}/medications',   'main:visit:read',         'main:tenant/${auth:tenant_id}/user/${auth:user_id}/visit/${path.id}'),
    ('GET',    '/notification-rules',        'main:notification:read',  'main:tenant/${auth:tenant_id}/user/${auth:user_id}/notification'),
    ('POST',   '/notification-rules',        'main:notification:write', 'main:tenant/${auth:tenant_id}/user/${auth:user_id}/notification'),
    ('PATCH',  '/notification-rules/{id}',   'main:notification:write', 'main:tenant/${auth:tenant_id}/user/${auth:user_id}/notification/${path.id}'),
    ('DELETE', '/notification-rules/{id}',   'main:notification:write', 'main:tenant/${auth:tenant_id}/user/${auth:user_id}/notification/${path.id}'),
    ('POST',   '/notify/manual',             'main:push:send',          'main:tenant/${auth:tenant_id}/push'),
    ('GET',    '/patients',                  'main:patient:read',       'main:tenant/${auth:tenant_id}/patient/*'),
    ('GET',    '/patients/{id}',             'main:patient:read',       'main:tenant/${auth:tenant_id}/patient/${path.id}'),
    ('POST',   '/patients/bind',             'main:patient:write',      'main:tenant/${auth:tenant_id}/patient'),
    ('POST',   '/upload/presigned-url',      'main:upload:write',       'main:tenant/${auth:tenant_id}/upload')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'main';

-- ── Seed: frontend /admin/* 頁面（要 super_admin 才能看）──
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'GET', '/admin/*', 'ui:admin:view', 'ui:admin'
FROM services s
WHERE s.name = 'frontend';

-- ── Seed: auth service admin action mappings（跨 tenant；只給 super_admin） ──
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',    '/admin/users',                    'auth:user:read',   'auth:user/*'),
    ('POST',   '/admin/users',                    'auth:user:write',  'auth:user'),
    ('PATCH',  '/admin/users/{id}',               'auth:user:write',  'auth:user/${path.id}'),
    ('POST',   '/admin/users/{id}/binding-token', 'auth:user:write',  'auth:user/${path.id}'),
    ('GET',    '/admin/roles',                    'auth:role:read',   'auth:role/*'),
    ('POST',   '/admin/roles',                    'auth:role:write',  'auth:role'),
    ('DELETE', '/admin/roles/{id}',               'auth:role:write',  'auth:role/${path.id}'),
    ('GET',    '/admin/roles/{id}/policies',      'auth:role:read',   'auth:role/${path.id}'),
    ('PUT',    '/admin/roles/{id}/policies',      'auth:role:write',  'auth:role/${path.id}'),
    ('GET',    '/admin/policies',                 'auth:policy:read', 'auth:policy/*'),
    ('GET',    '/admin/tenants',                  'auth:tenant:read', 'auth:tenant/*'),
    ('POST',   '/admin/tenants',                  'auth:tenant:write','auth:tenant')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'auth';

-- ── Seed: 5 份預設 policies ───────────────────
INSERT INTO policies (name, document) VALUES
    ('patient-self-access', '{
        "statements": [
            {
                "effect": "allow",
                "actions": [
                    "main:food_log:*",
                    "main:inbody:read",
                    "main:visit:read",
                    "main:notification:*",
                    "main:upload:write"
                ],
                "resources": [
                    "main:tenant/${auth:tenant_id}/user/${auth:user_id}/*",
                    "main:tenant/${auth:tenant_id}/upload"
                ]
            }
        ]
    }'::jsonb),

    ('staff-clinic-ops', '{
        "statements": [
            {
                "effect": "allow",
                "actions": [
                    "main:inbody:*",
                    "main:food_log:read",
                    "main:visit:*",
                    "main:patient:read",
                    "main:upload:write"
                ],
                "resources": ["main:tenant/${auth:tenant_id}/*"]
            }
        ]
    }'::jsonb),

    ('nutritionist-ops', '{
        "statements": [
            {
                "effect": "allow",
                "actions": [
                    "main:push:send",
                    "main:food_log:read",
                    "main:inbody:*",
                    "main:visit:read",
                    "main:notification:write",
                    "main:patient:read",
                    "main:upload:write"
                ],
                "resources": ["main:tenant/${auth:tenant_id}/*"]
            }
        ]
    }'::jsonb),

    ('clinic-admin', '{
        "statements": [
            {
                "effect": "allow",
                "actions": [
                    "main:patient:*",
                    "main:inbody:*",
                    "main:food_log:*",
                    "main:visit:*",
                    "main:notification:*",
                    "main:push:*",
                    "main:upload:write"
                ],
                "resources": ["main:tenant/${auth:tenant_id}/*"]
            }
        ]
    }'::jsonb),

    ('super-admin-all', '{
        "statements": [
            {
                "effect": "allow",
                "actions":   ["*"],
                "resources": ["*"]
            }
        ]
    }'::jsonb);

-- ── Seed: 綁 policies 給預設角色 ──────────────
INSERT INTO role_policies (role_id, policy_id)
SELECT r.id, p.id
FROM roles r, policies p
WHERE (r.name, p.name) IN (
    ('patient',      'patient-self-access'),
    ('staff',        'staff-clinic-ops'),
    ('nutritionist', 'nutritionist-ops'),
    ('admin',        'clinic-admin'),
    ('super_admin',  'super-admin-all')
);

COMMIT;
