-- 將 users.line_uuid / users.google_email / users.password_hash 拆成獨立的
-- auth_identities 表。將來加 Google / Apple / GitHub / WebAuthn 等 provider
-- 都不用再 ALTER users，只要 INSERT 一列。
--
-- 設計決策（2026-04-21 與產品方確認）：
--   1. Password 一起納入 identities（provider='password', subject=email,
--      secret_hash=bcrypt）— 一次到位，未來不用再切例外。
--   2. google_email 欄位目前空表 → 直接 drop，不 backfill。
--   3. 同一 user 同 provider 最多一筆（UNIQUE user_id + provider）— 產品面
--      罕見同一人需要綁兩個 Google/Apple；之後真有需求再放寬。
--
-- Backfill：
--   - line_uuid 非空的 active user → provider='line'
--   - password_hash + google_email 都非空的 user → provider='password'
--     （舊 /auth/password-login 的 WHERE 就要求這兩個都存在，backfill 語義一致）
--   - google_email 單獨存在但沒 password_hash 的 row → 丟掉（反正沒人能用）

BEGIN;

CREATE TABLE auth_identities (
    id            BIGSERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      VARCHAR(20)  NOT NULL,
    subject       VARCHAR(255) NOT NULL,
    secret_hash   VARCHAR(255),                       -- password bcrypt；其他 provider NULL
    metadata      JSONB,                              -- display_name / picture / scopes 等 provider-specific 資料
    last_used_at  TIMESTAMP,
    -- 同既有 audit 規範
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by    INT,
    updated_at    TIMESTAMP,
    updated_by    INT,
    deleted_at    TIMESTAMP,
    deleted_by    INT
);

-- 一個外部 identity 只能綁給一個 user
CREATE UNIQUE INDEX idx_auth_identities_provider_subject
    ON auth_identities (provider, subject)
    WHERE deleted_at IS NULL;

-- 一個 user 每個 provider 最多一筆（未刪除狀態）
CREATE UNIQUE INDEX idx_auth_identities_user_provider
    ON auth_identities (user_id, provider)
    WHERE deleted_at IS NULL;

-- user_id 反查用
CREATE INDEX idx_auth_identities_user ON auth_identities (user_id);

-- 稽核 trigger —— 同既有 pattern
CREATE TRIGGER trg_auth_identities_audit
    BEFORE INSERT OR UPDATE ON auth_identities
    FOR EACH ROW EXECUTE FUNCTION audit_autofill();

-- ── Backfill ──

INSERT INTO auth_identities (user_id, provider, subject, last_used_at, created_at)
SELECT id, 'line', line_uuid, NULL, COALESCE(created_at, NOW())
FROM users
WHERE line_uuid IS NOT NULL AND line_uuid != '' AND deleted_at IS NULL;

INSERT INTO auth_identities (user_id, provider, subject, secret_hash, last_used_at, created_at)
SELECT id, 'password', google_email, password_hash, NULL, COALESCE(created_at, NOW())
FROM users
WHERE password_hash IS NOT NULL
  AND google_email IS NOT NULL
  AND google_email != ''
  AND deleted_at IS NULL;

-- ── Drop 舊 columns ──
-- index + unique constraint 會連動 drop
ALTER TABLE users
    DROP COLUMN line_uuid,
    DROP COLUMN google_email,
    DROP COLUMN password_hash;

COMMIT;
