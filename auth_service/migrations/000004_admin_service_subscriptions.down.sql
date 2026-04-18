BEGIN;

-- 1. 拿掉 admin service 的 action_mappings
DELETE FROM action_mappings
 WHERE service_id = (SELECT id FROM services WHERE name = 'admin');

-- 2. 刪 admin service 本身
DELETE FROM services WHERE name = 'admin';

-- 3. 拆掉訂閱表
DROP INDEX IF EXISTS idx_tenant_roles_tenant;
DROP INDEX IF EXISTS idx_tenant_services_tenant;
DROP TABLE IF EXISTS tenant_roles;
DROP TABLE IF EXISTS tenant_services;

-- Note: 原本放在 auth / frontend service 的 action_mappings 是這個 migration 刪掉的，
-- down 不回推到原本的 auth:* / ui:admin:view（那是歷史包袱），需重跑 000002 種子才會回來。

COMMIT;
