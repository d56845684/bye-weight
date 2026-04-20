-- 還原 000014：把 clinic-admin 政策回到 000012 的狀態（兩個 statements）

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
      "actions": ["admin:user:read", "admin:user:write"],
      "resources": [
        "admin:tenant/${auth:tenant_id}/user",
        "admin:tenant/${auth:tenant_id}/user/*"
      ]
    }
  ]
}'::jsonb
WHERE name = 'clinic-admin';

COMMIT;
