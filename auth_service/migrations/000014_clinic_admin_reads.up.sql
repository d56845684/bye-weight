-- clinic-admin 要能操作 /admin/users UI 需要：
--   * admin:role:read —— 列出所有 role 作為建立 user 的下拉選單（role 僅是名稱，
--     不涉資料；全域可讀 OK）
--   * admin:tenant:read on 自己 tenant —— 讀 /admin/tenants/{id} 與
--     /admin/tenants/{id}/roles 來知道可發的角色。不開放列所有 tenant。
--
-- super-admin-all 透過 *:* wildcard 已涵蓋這些；只更新 clinic-admin。

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
