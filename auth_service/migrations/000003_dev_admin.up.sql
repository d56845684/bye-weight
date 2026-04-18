-- auth_db: 開發用 super_admin 帳號
-- 僅供本機測試；正式環境請自行刪除或以 Google OAuth 取代。
-- 預設密碼：admin@dev.local / admin123（bcrypt cost 10）。

BEGIN;

INSERT INTO users (line_uuid, google_email, password_hash, display_name, role_id, tenant_id, active)
SELECT 'dev-admin',
       'admin@dev.local',
       crypt('admin123', gen_salt('bf', 10)),
       'Dev Super Admin',
       r.id,
       0,
       true
FROM roles r
WHERE r.name = 'super_admin'
ON CONFLICT (line_uuid) DO NOTHING;

COMMIT;
