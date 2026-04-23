-- auth_db: 註冊 kuji 服務 + kuji_user 角色 + 6 個 dev user（demo tenant）。
--
-- Kuji 有自己的 backend（/kuji/api/v1），獨立的 IAM 資源 namespace `kuji:`。
-- kuji_user policy 允許 tenant 內的所有 kuji:* 操作（meeting / task / integration / team / self）。
--
-- Dev seed：tenant_id=1 (Acme 示範租戶) + 6 個使用者 id 1001..1006，密碼 demo123。
-- kuji_backend 的 migration 0004_seed_mock_data 用 auth_user_id 1001..1006 對應這些 user。
--
-- 註：users 跟 auth_identities 分離（見 000021 migration），password 存在
-- auth_identities.secret_hash (provider='password', subject=email)。

BEGIN;

-- 1. tenant
INSERT INTO tenants (id, slug, name, active) VALUES (1, 'acme', 'Acme Demo', true)
ON CONFLICT (id) DO NOTHING;

-- 2. role
INSERT INTO roles (name) VALUES ('kuji_user') ON CONFLICT (name) DO NOTHING;

-- 3. service
INSERT INTO services (name, prefix) VALUES ('kuji', '/kuji/api/v1')
ON CONFLICT (name) DO NOTHING;

-- 3b. tenant_services：所有現存 tenant 都訂閱 kuji service（含 system=0）
INSERT INTO tenant_services (tenant_id, service_id)
SELECT t.id, s.id
FROM tenants t, services s
WHERE s.name = 'kuji'
ON CONFLICT DO NOTHING;

-- 4. action_mappings
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, v.method, v.pattern, v.action, v.tpl
FROM services s,
(VALUES
    ('GET',    '/meetings',                   'kuji:meeting:read',   'kuji:tenant/${auth:tenant_id}/meeting/*'),
    ('POST',   '/meetings',                   'kuji:meeting:write',  'kuji:tenant/${auth:tenant_id}/meeting'),
    ('GET',    '/meetings/{id}',              'kuji:meeting:read',   'kuji:tenant/${auth:tenant_id}/meeting/${path.id}'),
    ('PATCH',  '/meetings/{id}',              'kuji:meeting:write',  'kuji:tenant/${auth:tenant_id}/meeting/${path.id}'),
    ('GET',    '/tasks',                      'kuji:task:read',      'kuji:tenant/${auth:tenant_id}/task/*'),
    ('POST',   '/tasks',                      'kuji:task:write',     'kuji:tenant/${auth:tenant_id}/task'),
    ('GET',    '/tasks/{id}',                 'kuji:task:read',      'kuji:tenant/${auth:tenant_id}/task/${path.id}'),
    ('PATCH',  '/tasks/{id}',                 'kuji:task:write',     'kuji:tenant/${auth:tenant_id}/task/${path.id}'),
    ('DELETE', '/tasks/{id}',                 'kuji:task:write',     'kuji:tenant/${auth:tenant_id}/task/${path.id}'),
    ('GET',    '/integrations',               'kuji:integration:read', 'kuji:tenant/${auth:tenant_id}/integration/*'),
    ('POST',   '/integrations/{kind}/toggle', 'kuji:integration:write','kuji:tenant/${auth:tenant_id}/integration/${path.kind}'),
    ('GET',    '/team/members',               'kuji:team:read',      'kuji:tenant/${auth:tenant_id}/team/*'),
    ('GET',    '/me',                         'kuji:self:read',      'kuji:tenant/${auth:tenant_id}/user/${auth:user_id}')
) AS v(method, pattern, action, tpl)
WHERE s.name = 'kuji'
ON CONFLICT DO NOTHING;

-- 5. policy
INSERT INTO policies (name, document) VALUES
    ('kuji-user-policy', '{
        "statements": [
            {
                "effect": "allow",
                "actions":   ["kuji:*"],
                "resources": ["kuji:tenant/${auth:tenant_id}/*"]
            }
        ]
    }'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- 6. role_policies
INSERT INTO role_policies (role_id, policy_id)
SELECT r.id, p.id
FROM roles r, policies p
WHERE r.name = 'kuji_user' AND p.name = 'kuji-user-policy'
ON CONFLICT DO NOTHING;

-- 7. Seed 6 個 dev users（id 1001..1006，對應 kuji_backend team_members.auth_user_id）
INSERT INTO users (id, display_name, role_id, tenant_id, active)
SELECT v.id, v.name, r.id, 1, true
FROM roles r,
(VALUES
    (1001, '林怡君'),
    (1002, 'Sam Wu'),
    (1003, '陳柏翰'),
    (1004, 'Emma Chen'),
    (1005, '張士豪'),
    (1006, '黃雅婷')
) AS v(id, name)
WHERE r.name = 'kuji_user'
ON CONFLICT (id) DO NOTHING;

-- 推 sequence，避免後續 INSERT 撞到 1001..1006
SELECT setval('users_id_seq', GREATEST(1006, (SELECT COALESCE(MAX(id), 0) FROM users)));

-- 8. password identities（provider=password, subject=email, secret_hash=bcrypt('demo123')）
INSERT INTO auth_identities (user_id, provider, subject, secret_hash)
VALUES
    (1001, 'password', 'emily@acme.com', crypt('demo123', gen_salt('bf', 10))),
    (1002, 'password', 'sam@acme.com',   crypt('demo123', gen_salt('bf', 10))),
    (1003, 'password', 'brian@acme.com', crypt('demo123', gen_salt('bf', 10))),
    (1004, 'password', 'emma@acme.com',  crypt('demo123', gen_salt('bf', 10))),
    (1005, 'password', 'ray@acme.com',   crypt('demo123', gen_salt('bf', 10))),
    (1006, 'password', 'tina@acme.com',  crypt('demo123', gen_salt('bf', 10)))
ON CONFLICT DO NOTHING;

COMMIT;
