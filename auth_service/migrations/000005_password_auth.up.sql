-- auth_db: 密碼登入（後台管理員用）
-- 預設 super_admin 帳號：admin@dev.local / admin123（dev 環境，正式請自行修改）

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- seed dev-admin 的密碼（bcrypt cost 10）
UPDATE users
SET password_hash = crypt('admin123', gen_salt('bf', 10))
WHERE line_uuid = 'dev-admin' AND password_hash IS NULL;

COMMIT;
