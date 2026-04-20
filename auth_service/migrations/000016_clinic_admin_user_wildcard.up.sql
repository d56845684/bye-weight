-- Fix：clinic-admin 原本用 admin:user:read / admin:user:write 字面列舉，
-- 沒涵蓋新加的 admin:user:invite。改成 admin:user:* 讓未來新增 admin:user:*
-- 系列 action 不用再回頭改 policy。

BEGIN;

UPDATE policies
SET document = '{
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
        "main:upload:write",
        "admin:view"
      ],
      "resources": [
        "main:tenant/${auth:tenant_id}/*",
        "admin:page"
      ]
    },
    {
      "effect": "allow",
      "actions": ["admin:user:*"],
      "resources": [
        "admin:tenant/${auth:tenant_id}/user",
        "admin:tenant/${auth:tenant_id}/user/*"
      ]
    },
    {
      "effect": "allow",
      "actions": ["admin:role:read"],
      "resources": ["admin:role/*"]
    },
    {
      "effect": "allow",
      "actions": ["admin:tenant:read"],
      "resources": [
        "admin:tenant/${auth:tenant_id}",
        "admin:tenant/${auth:tenant_id}/*"
      ]
    }
  ]
}'::jsonb
WHERE name = 'clinic-admin';

COMMIT;
