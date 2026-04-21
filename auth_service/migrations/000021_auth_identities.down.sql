-- 還原 auth_identities → users 的拆分。
-- 僅 dev/test 用；生產環境下 schema 已被多支服務/查詢依賴，down 不保證可逆。

BEGIN;

ALTER TABLE users
    ADD COLUMN line_uuid     VARCHAR(64),
    ADD COLUMN google_email  VARCHAR(100),
    ADD COLUMN password_hash VARCHAR(255);

UPDATE users u
SET line_uuid = i.subject
FROM auth_identities i
WHERE i.user_id = u.id
  AND i.provider = 'line'
  AND i.deleted_at IS NULL;

UPDATE users u
SET google_email = i.subject,
    password_hash = i.secret_hash
FROM auth_identities i
WHERE i.user_id = u.id
  AND i.provider = 'password'
  AND i.deleted_at IS NULL;

CREATE UNIQUE INDEX users_line_uuid_key    ON users (line_uuid);
CREATE UNIQUE INDEX users_google_email_key ON users (google_email);
CREATE INDEX        idx_users_line_uuid    ON users (line_uuid);
CREATE INDEX        idx_users_google_email ON users (google_email);

DROP TABLE auth_identities;

COMMIT;
