-- auth_db: 開發用 super admin 帳號
-- 僅供本機測試使用；上線前請自行刪除或以真實 Google OAuth 帳號取代

BEGIN;

INSERT INTO users (line_uuid, google_email, role_id, clinic_id, patient_id, active)
SELECT 'dev-admin', 'admin@dev.local', r.id, 'C001', NULL, true
FROM roles r
WHERE r.name = 'admin'
ON CONFLICT (line_uuid) DO NOTHING;

COMMIT;
