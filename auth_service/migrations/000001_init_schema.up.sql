-- auth_db: 初始 schema（RBAC + PBAC + 使用者 + 稽核）

BEGIN;

-- ── RBAC ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) UNIQUE NOT NULL,
    resource    VARCHAR(50)  NOT NULL,
    action      VARCHAR(20)  NOT NULL,
    url_pattern VARCHAR(200),
    http_method VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       INT REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ── PBAC ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policies (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(100) UNIQUE NOT NULL,
    effect VARCHAR(10) DEFAULT 'allow'
);

CREATE TABLE IF NOT EXISTS policy_conditions (
    id             SERIAL PRIMARY KEY,
    policy_id      INT REFERENCES policies(id) ON DELETE CASCADE,
    condition_type VARCHAR(30) NOT NULL,
    operator       VARCHAR(20) NOT NULL,
    value_config   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_policies (
    permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
    policy_id     INT REFERENCES policies(id) ON DELETE CASCADE,
    PRIMARY KEY (permission_id, policy_id)
);

-- ── 使用者 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    line_uuid     VARCHAR(64) UNIQUE,
    google_email  VARCHAR(100) UNIQUE,
    role_id       INT REFERENCES roles(id) NOT NULL,
    clinic_id     VARCHAR(20) NOT NULL,
    patient_id    INT,
    active        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_line_uuid    ON users(line_uuid);
CREATE INDEX IF NOT EXISTS idx_users_google_email ON users(google_email);

-- ── 稽核 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE SET NULL,
    login_at   TIMESTAMP DEFAULT NOW(),
    ip         VARCHAR(45),
    user_agent TEXT
);

COMMIT;
