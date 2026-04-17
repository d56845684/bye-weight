-- auth_db: users 加 display_name 欄位
-- 用於後台辨識使用者（未綁 LINE 前還沒有 profile 資訊）

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);

-- 把既有 dev-admin 補上名稱方便辨認
UPDATE users SET display_name = 'Dev Super Admin'
WHERE line_uuid = 'dev-admin' AND display_name IS NULL;

COMMIT;
