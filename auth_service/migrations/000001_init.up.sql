-- auth_db: identity 層
-- 只包含使用者身份、租戶、角色、登入稽核。授權相關的 policies 由 000002 負責。

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 租戶（Hard isolation）──────────────────────
-- id=0 保留給 system tenant（super_admin 專用）；真實租戶從 1 起。
CREATE TABLE tenants (
    id         INT PRIMARY KEY,
    slug       VARCHAR(50) UNIQUE NOT NULL,
    name       VARCHAR(100) NOT NULL,
    active     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO tenants (id, slug, name) VALUES (0, 'system', 'System');

-- ── 角色（目前全域；Soft isolation 升級時再加 tenant_id nullable）──
CREATE TABLE roles (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);

INSERT INTO roles (name) VALUES
    ('patient'),
    ('staff'),
    ('nutritionist'),
    ('admin'),
    ('super_admin');

-- ── 使用者 ─────────────────────────────────────
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    line_uuid     VARCHAR(64) UNIQUE,
    google_email  VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255),
    display_name  VARCHAR(50),
    role_id       INT NOT NULL REFERENCES roles(id),
    tenant_id     INT NOT NULL DEFAULT 0 REFERENCES tenants(id),
    active        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_users_line_uuid    ON users(line_uuid);
CREATE INDEX idx_users_google_email ON users(google_email);
CREATE INDEX idx_users_tenant       ON users(tenant_id);

-- ── 登入稽核 ──────────────────────────────────
CREATE TABLE login_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE SET NULL,
    login_at   TIMESTAMP DEFAULT NOW(),
    ip         VARCHAR(45),
    user_agent TEXT
);

COMMIT;
