-- 開發環境初始化：建立兩個資料庫
CREATE DATABASE auth_db;
CREATE DATABASE app_db;

-- 初始化 auth_db
\c auth_db;

-- ── RBAC ─────────────────────────────────────────
CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE permissions (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) UNIQUE NOT NULL,
    resource    VARCHAR(50)  NOT NULL,
    action      VARCHAR(20)  NOT NULL,
    url_pattern VARCHAR(200),
    http_method VARCHAR(10)
);

CREATE TABLE role_permissions (
    role_id       INT REFERENCES roles(id),
    permission_id INT REFERENCES permissions(id),
    PRIMARY KEY (role_id, permission_id)
);

-- ── PBAC ─────────────────────────────────────────
CREATE TABLE policies (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(100) UNIQUE NOT NULL,
    effect VARCHAR(10) DEFAULT 'allow'
);

CREATE TABLE policy_conditions (
    id             SERIAL PRIMARY KEY,
    policy_id      INT REFERENCES policies(id),
    condition_type VARCHAR(30) NOT NULL,
    operator       VARCHAR(20) NOT NULL,
    value_config   JSONB NOT NULL
);

CREATE TABLE permission_policies (
    permission_id INT REFERENCES permissions(id),
    policy_id     INT REFERENCES policies(id),
    PRIMARY KEY (permission_id, policy_id)
);

-- ── 使用者 ───────────────────────────────────────
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    line_uuid     VARCHAR(64) UNIQUE,
    google_email  VARCHAR(100) UNIQUE,
    role_id       INT REFERENCES roles(id) NOT NULL,
    clinic_id     VARCHAR(20) NOT NULL,
    patient_id    INT,
    active        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_users_line_uuid    ON users(line_uuid);
CREATE INDEX idx_users_google_email ON users(google_email);

-- ── 稽核 ─────────────────────────────────────────
CREATE TABLE login_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id),
    login_at   TIMESTAMP DEFAULT NOW(),
    ip         VARCHAR(45),
    user_agent TEXT
);

-- ── 初始角色 ─────────────────────────────────────
INSERT INTO roles (name) VALUES ('patient'), ('staff'), ('nutritionist'), ('admin');

-- ── 初始權限（含 url_pattern + http_method）─────
INSERT INTO permissions (name, resource, action, url_pattern, http_method) VALUES
    ('inbody:read',        'inbody',        'read',   '/inbody',        'GET'),
    ('inbody:write',       'inbody',        'write',  '/inbody',        'POST'),
    ('food_log:read',      'food_log',      'read',   '/food-logs',     'GET'),
    ('food_log:write',     'food_log',      'write',  '/food-logs',     'POST'),
    ('visit:read',         'visit',         'read',   '/visits',        'GET'),
    ('visit:write',        'visit',         'write',  '/visits',        'POST'),
    ('notification:read',  'notification',  'read',   '/notifications', 'GET'),
    ('notification:write', 'notification',  'write',  '/notifications', 'PATCH'),
    ('push:send',          'push',          'send',   '/notify',        'POST'),
    ('patient:manage',     'patient',       'manage', '/patients',      'GET'),
    ('upload:write',       'upload',        'write',  '/upload',        'POST');

-- ── 角色-權限映射 ────────────────────────────────
-- patient: 可讀自己的 inbody、food_log、visit、notification，可寫 food_log、upload
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'patient' AND p.name IN (
    'inbody:read', 'food_log:read', 'food_log:write',
    'visit:read', 'notification:read', 'upload:write'
);

-- staff: patient 權限 + inbody:write + visit:write
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'staff' AND p.name IN (
    'inbody:read', 'inbody:write', 'food_log:read',
    'visit:read', 'visit:write', 'notification:read', 'upload:write'
);

-- nutritionist: staff 權限 + push:send + notification:write
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nutritionist' AND p.name IN (
    'inbody:read', 'inbody:write', 'food_log:read', 'food_log:write',
    'visit:read', 'visit:write', 'notification:read', 'notification:write',
    'push:send', 'upload:write'
);

-- admin: 全部權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin';

-- ── PBAC 策略 ────────────────────────────────────
INSERT INTO policies (name, effect) VALUES
    ('own_data_only', 'allow'),
    ('same_clinic_only', 'allow');

INSERT INTO policy_conditions (policy_id, condition_type, operator, value_config) VALUES
    (1, 'resource_owner', 'eq', '{"subject_field": "patient_id", "resource_field": "patient_id"}'),
    (2, 'clinic_scope',   'eq', '{"subject_field": "clinic_id", "resource_field": "clinic_id"}');

-- patient 的讀取權限綁定 resource_owner 策略
INSERT INTO permission_policies (permission_id, policy_id)
SELECT p.id, pol.id FROM permissions p, policies pol
WHERE p.name IN ('inbody:read', 'food_log:read', 'visit:read', 'notification:read')
  AND pol.name = 'own_data_only';

-- ============================================================
-- 初始化 app_db
-- ============================================================
\c app_db;

CREATE TABLE employees (
    id         SERIAL PRIMARY KEY,
    line_uuid  VARCHAR(64) UNIQUE NOT NULL,
    name       VARCHAR(20),
    clinic_id  VARCHAR(20),
    role       VARCHAR(20) DEFAULT 'staff',
    active     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE patients (
    id         SERIAL PRIMARY KEY,
    his_id     VARCHAR(20),
    name       VARCHAR(20) NOT NULL,
    sex        CHAR(1),
    birth_date DATE NOT NULL,
    phone      VARCHAR(20),
    email      VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE line_bindings (
    id         SERIAL PRIMARY KEY,
    patient_id INT REFERENCES patients(id),
    line_uuid  VARCHAR(64) UNIQUE NOT NULL,
    clinic_id  VARCHAR(20),
    bound_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE visits (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    visit_date     DATE NOT NULL,
    doctor_id      VARCHAR(20),
    notes          TEXT,
    next_visit_date DATE,
    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE medications (
    id         SERIAL PRIMARY KEY,
    visit_id   INT REFERENCES visits(id),
    drug_name  VARCHAR(100),
    frequency  VARCHAR(20),
    days       INT,
    start_date DATE,
    end_date   DATE
);

CREATE TABLE inbody_records (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    uploaded_by    INT REFERENCES employees(id),
    measured_at    TIMESTAMP NOT NULL,
    weight         NUMERIC(5,2),
    bmi            NUMERIC(4,2),
    body_fat_pct   NUMERIC(4,2),
    muscle_mass    NUMERIC(5,2),
    visceral_fat   INT,
    metabolic_rate NUMERIC(6,0),
    image_url      TEXT,
    raw_json       JSONB,
    match_status   VARCHAR(20) DEFAULT 'matched',
    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE inbody_pending (
    id             SERIAL PRIMARY KEY,
    uploaded_by    INT REFERENCES employees(id),
    image_url      TEXT,
    ocr_name       VARCHAR(20),
    ocr_birth_date DATE,
    ocr_data       JSONB,
    status         VARCHAR(20) DEFAULT 'pending',
    uploaded_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE food_logs (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    logged_at      TIMESTAMP NOT NULL,
    meal_type      VARCHAR(10),
    image_url      TEXT,
    food_items     JSONB,
    total_calories NUMERIC(6,1),
    total_protein  NUMERIC(5,1),
    total_carbs    NUMERIC(5,1),
    total_fat      NUMERIC(5,1),
    ai_suggestion  TEXT
);

CREATE TABLE notification_rules (
    id             SERIAL PRIMARY KEY,
    patient_id     INT REFERENCES patients(id),
    type           VARCHAR(20) NOT NULL,
    days_before    INT,
    interval_days  INT,
    send_time      TIME DEFAULT '09:00',
    active         BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notification_logs (
    id              SERIAL PRIMARY KEY,
    patient_id      INT REFERENCES patients(id),
    type            VARCHAR(20),
    format          VARCHAR(10),
    message_content TEXT,
    status          VARCHAR(10) DEFAULT 'pending',
    scheduled_at    TIMESTAMP,
    sent_at         TIMESTAMP,
    line_uuid       VARCHAR(64)
);

-- ── 重要 Index ───────────────────────────────────
CREATE INDEX idx_line_bindings_uuid   ON line_bindings(line_uuid);
CREATE INDEX idx_employees_uuid       ON employees(line_uuid);
CREATE INDEX idx_inbody_patient_time  ON inbody_records(patient_id, measured_at DESC);
CREATE INDEX idx_food_patient_date    ON food_logs(patient_id, logged_at DESC);
CREATE INDEX idx_visits_next_visit    ON visits(next_visit_date) WHERE next_visit_date IS NOT NULL;
CREATE INDEX idx_notif_rules_active   ON notification_rules(patient_id) WHERE active = TRUE;
CREATE INDEX idx_notif_logs_status    ON notification_logs(status, scheduled_at) WHERE status = 'pending';
