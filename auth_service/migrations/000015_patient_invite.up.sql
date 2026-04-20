-- 邀請病患建立 LIFF 綁定連結：
--   action: admin:user:invite（跟 admin:user:write 分離，讓 super_admin 能把「只能邀請病患」
--           授給特定 staff 而不開放 user 全權管理）
--   endpoint: POST /auth/v1/admin/users/invite
--   seed policy: 'patient-inviter'（預設不綁任何 role，super_admin 手動指派）
--
-- clinic-admin 已有 admin:user:* wildcard 涵蓋 invite，不需改該 policy。

BEGIN;

-- 1. action_mapping
INSERT INTO action_mappings (service_id, http_method, url_pattern, action, resource_template)
SELECT s.id, 'POST', '/auth/v1/admin/users/invite',
       'admin:user:invite', 'admin:tenant/${auth:tenant_id}/user'
FROM services s WHERE s.name = 'admin'
ON CONFLICT DO NOTHING;

-- 2. seed 'patient-inviter' policy
INSERT INTO policies (name, document) VALUES
    ('patient-inviter', '{
        "statements": [
            {
                "effect": "allow",
                "actions": ["admin:user:invite"],
                "resources": ["admin:tenant/${auth:tenant_id}/user"]
            }
        ]
    }'::jsonb)
ON CONFLICT (name) DO NOTHING;

COMMIT;
