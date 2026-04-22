#!/usr/bin/env bash
# docs/seed.sh — 本機開發用 seed / cleanup 腳本
#
# 所有 seed 資料一律綁在 tenant_id=100 (slug='seed-clinic')。
# clean = 把這個 tenant 的所有資料（auth_db + app_db）砍光，
# 真實的租戶資料（tenant_id != 100）絕對不會動到。
#
# 用法：
#   docs/seed.sh apply     # 產生 seed 資料（若已存在會報錯，改用 reset）
#   docs/seed.sh clean     # 把 seed 資料刪光
#   docs/seed.sh reset     # clean 再 apply
#   docs/seed.sh status    # 顯示 seed 租戶的資料統計
#
# 所有 seed 帳號預設密碼：demo123
#   admin@seed.test   role=admin          → 進 /admin/login
#   nutri@seed.test   role=nutritionist
#   staff@seed.test   role=staff
#   alice@seed.test   role=patient
#   bob@seed.test     role=patient
#   carol@seed.test   role=patient

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-bye-weight-postgres-1}"
AUTH_CONTAINER="${AUTH_CONTAINER:-bye-weight-auth_service-1}"
SEED_TID=100
SEED_SLUG="seed-clinic"
SEED_PW="demo123"

psql_auth() {
    docker exec -i "$PG_CONTAINER" \
        psql -U postgres -d auth_db -v ON_ERROR_STOP=1 "$@"
}
psql_app() {
    docker exec -i "$PG_CONTAINER" \
        psql -U postgres -d app_db -v ON_ERROR_STOP=1 "$@"
}

require_pg() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
        echo "✗ postgres container '$PG_CONTAINER' not running." >&2
        echo "  先跑： docker compose -f docker-compose.dev.yml up -d postgres" >&2
        exit 1
    fi
}

# auth_service 的 policy engine 會 in-memory cache tenant_services /
# action_mappings / role_policies，ticker 每 5 分鐘才 reload。seed 改了 DB 之
# 後必須戳它一下，否則新 tenant 的訂閱關係在 cache 反映前，verify 會擋。
reload_auth_engine() {
    if docker ps --format '{{.Names}}' | grep -q "^${AUTH_CONTAINER}$"; then
        echo "→ 重啟 $AUTH_CONTAINER 讓 policy engine 重新載入 cache"
        docker restart "$AUTH_CONTAINER" >/dev/null
    fi
}

# ────────────────────────────────────────────────────
# clean
# ────────────────────────────────────────────────────
cmd_clean() {
    echo "→ [app_db] 清除 tenant_id=$SEED_TID 的所有業務資料"
    psql_app -v tid="$SEED_TID" >/dev/null <<'SQL'
BEGIN;
SET LOCAL app.bypass_rls = 'true';

DELETE FROM notification_logs  WHERE tenant_id = :tid;
DELETE FROM notification_rules WHERE tenant_id = :tid;
DELETE FROM medications        WHERE tenant_id = :tid;
DELETE FROM visits             WHERE tenant_id = :tid;
DELETE FROM food_logs          WHERE tenant_id = :tid;
DELETE FROM inbody_records     WHERE tenant_id = :tid;
DELETE FROM inbody_pending     WHERE tenant_id = :tid;
DELETE FROM patient_goals      WHERE tenant_id = :tid;
DELETE FROM line_bindings      WHERE tenant_id = :tid;
DELETE FROM patients           WHERE tenant_id = :tid;
DELETE FROM employees          WHERE tenant_id = :tid;

COMMIT;
SQL

    echo "→ [auth_db] 清除 tenant_id=$SEED_TID 的 users / identities / tenant bindings"
    psql_auth -v tid="$SEED_TID" >/dev/null <<'SQL'
BEGIN;

DELETE FROM login_logs
    WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid);
DELETE FROM auth_identities
    WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid);
DELETE FROM users           WHERE tenant_id = :tid;
DELETE FROM tenant_roles    WHERE tenant_id = :tid;
DELETE FROM tenant_services WHERE tenant_id = :tid;
DELETE FROM tenants         WHERE id        = :tid;

COMMIT;
SQL

    reload_auth_engine
    echo "✓ seed 資料已清除。"
}

# ────────────────────────────────────────────────────
# apply
# ────────────────────────────────────────────────────
cmd_apply() {
    # 先檢查是否已有 seed 租戶
    existing=$(psql_auth -At -c "SELECT COUNT(*) FROM tenants WHERE id=$SEED_TID")
    if [[ "$existing" != "0" ]]; then
        echo "✗ seed 租戶 (id=$SEED_TID) 已經存在。" >&2
        echo "  若要重建請跑： $0 reset" >&2
        exit 1
    fi

    echo "→ [auth_db] 建立 tenant / users / identities"
    psql_auth \
        -v tid="$SEED_TID" \
        -v slug="$SEED_SLUG" \
        -v pw="$SEED_PW" \
        >/dev/null <<'SQL'
BEGIN;

-- Tenant
INSERT INTO tenants (id, slug, name, active)
VALUES (:tid, :'slug', '[SEED] Demo Clinic', true);

-- 訂閱預設 services / roles（跟 POST /admin/tenants 邏輯一致）
INSERT INTO tenant_services (tenant_id, service_id)
SELECT :tid, id FROM services
WHERE name IN ('auth','main','frontend','admin');

INSERT INTO tenant_roles (tenant_id, role_id)
SELECT :tid, id FROM roles
WHERE name IN ('patient','staff','nutritionist','admin');

-- Users
INSERT INTO users (display_name, role_id, tenant_id, active)
SELECT v.disp, r.id, :tid, true
FROM roles r
JOIN (VALUES
    ('admin',        '[SEED] Clinic Admin'),
    ('nutritionist', '[SEED] Nutritionist'),
    ('staff',        '[SEED] Staff'),
    ('patient',      '[SEED] Alice Wang'),
    ('patient',      '[SEED] Bob Chen'),
    ('patient',      '[SEED] Carol Lin')
) AS v(role_name, disp) ON r.name = v.role_name;

-- Password identities (provider=password, subject=email, secret_hash=bcrypt)
INSERT INTO auth_identities (user_id, provider, subject, secret_hash)
SELECT u.id, 'password', v.email, crypt(:'pw', gen_salt('bf', 10))
FROM users u
JOIN (VALUES
    ('[SEED] Clinic Admin', 'admin@seed.test'),
    ('[SEED] Nutritionist', 'nutri@seed.test'),
    ('[SEED] Staff',        'staff@seed.test'),
    ('[SEED] Alice Wang',   'alice@seed.test'),
    ('[SEED] Bob Chen',     'bob@seed.test'),
    ('[SEED] Carol Lin',    'carol@seed.test')
) AS v(disp, email) ON u.display_name = v.disp
WHERE u.tenant_id = :tid;

COMMIT;
SQL

    # 把 auth user id 抓出來，給 app_db 用
    ADMIN_UID=$(psql_auth -At -c "SELECT id FROM users WHERE display_name='[SEED] Clinic Admin' AND tenant_id=$SEED_TID")
    NUTRI_UID=$(psql_auth -At -c "SELECT id FROM users WHERE display_name='[SEED] Nutritionist' AND tenant_id=$SEED_TID")
    STAFF_UID=$(psql_auth -At -c "SELECT id FROM users WHERE display_name='[SEED] Staff'        AND tenant_id=$SEED_TID")
    ALICE_UID=$(psql_auth -At -c "SELECT id FROM users WHERE display_name='[SEED] Alice Wang'   AND tenant_id=$SEED_TID")
    BOB_UID=$(psql_auth   -At -c "SELECT id FROM users WHERE display_name='[SEED] Bob Chen'     AND tenant_id=$SEED_TID")
    CAROL_UID=$(psql_auth -At -c "SELECT id FROM users WHERE display_name='[SEED] Carol Lin'    AND tenant_id=$SEED_TID")

    echo "→ [app_db] 建立 employees / patients / goals / inbody / food / visits / notifications"
    psql_app \
        -v tid="$SEED_TID" \
        -v admin_uid="$ADMIN_UID" \
        -v nutri_uid="$NUTRI_UID" \
        -v staff_uid="$STAFF_UID" \
        -v alice_uid="$ALICE_UID" \
        -v bob_uid="$BOB_UID" \
        -v carol_uid="$CAROL_UID" \
        >/dev/null <<'SQL'
BEGIN;
SET LOCAL app.bypass_rls = 'true';

-- Employees（staff 端用來上傳 inbody）
INSERT INTO employees (line_uuid, name, clinic_id, role, tenant_id, active) VALUES
    ('seed-emp-admin', '[SEED] Clinic Admin', 'SEED', 'admin',        :tid, true),
    ('seed-emp-nutri', '[SEED] Nutritionist', 'SEED', 'nutritionist', :tid, true),
    ('seed-emp-staff', '[SEED] Staff',        'SEED', 'staff',        :tid, true);

-- Patients（auth_user_id 綁回 auth_db 上的 3 位病患 user）
INSERT INTO patients (name, birth_date, sex, chart_no, phone, email, his_id, tenant_id, auth_user_id) VALUES
    ('[SEED] Alice Wang', '1985-03-12', 'F', 'SEED-001', '0912-345-001', 'alice@seed.test', 'SEED-H001', :tid, :alice_uid),
    ('[SEED] Bob Chen',   '1978-11-05', 'M', 'SEED-002', '0912-345-002', 'bob@seed.test',   'SEED-H002', :tid, :bob_uid),
    ('[SEED] Carol Lin',  '1990-07-21', 'F', 'SEED-003', '0912-345-003', 'carol@seed.test', 'SEED-H003', :tid, :carol_uid);

-- 把剛塞進去的 patient / employee id 抓回來當變數
SELECT id AS alice_pid FROM patients  WHERE chart_no='SEED-001'       AND tenant_id=:tid \gset
SELECT id AS bob_pid   FROM patients  WHERE chart_no='SEED-002'       AND tenant_id=:tid \gset
SELECT id AS carol_pid FROM patients  WHERE chart_no='SEED-003'       AND tenant_id=:tid \gset
SELECT id AS staff_eid FROM employees WHERE line_uuid='seed-emp-staff' AND tenant_id=:tid \gset

-- 病患目標（nutritionist 訂的）
INSERT INTO patient_goals
    (patient_id, tenant_id, target_weight, target_body_fat, daily_kcal,
     target_carbs_pct, target_protein_pct, target_fat_pct, effective_from, set_by, notes) VALUES
    (:alice_pid, :tid, 58.0, 25.0, 1500, 50, 25, 25, CURRENT_DATE - 30, :nutri_uid, '[SEED] 減脂計畫 3 個月目標 -8 kg'),
    (:bob_pid,   :tid, 72.0, 22.0, 1800, 45, 30, 25, CURRENT_DATE - 30, :nutri_uid, '[SEED] 代謝改善 + 肌肉量維持'),
    (:carol_pid, :tid, 54.0, 23.0, 1400, 50, 25, 25, CURRENT_DATE - 30, :nutri_uid, '[SEED] 維持期');

-- InBody：每位 8 週每週量一次，漸進式變化。
-- 分部位 (muscle_segmental / fat_segmental) 用 JSONB 存 {la,ra,tr,ll,rl}，
-- 採臨床常見比例：骨骼肌 5/5/50/20/20 %；脂肪 7/7/54/16/16 %。
-- 這樣 /patient/inbody 的 BodyMap 會有可視化資料（否則只顯示「尚無分部位資料」）。
INSERT INTO inbody_records
    (patient_id, uploaded_by, measured_at,
     weight, bmi, body_fat_pct, muscle_mass, visceral_fat, metabolic_rate,
     body_age, total_body_water, protein_mass, mineral_mass,
     muscle_segmental, fat_segmental,
     match_status, tenant_id)
SELECT p.pid,
       :staff_eid,
       NOW() - (w * INTERVAL '7 days'),
       ROUND((p.w0 - w * 0.4)::numeric, 1)   AS wt,
       ROUND((p.b0 - w * 0.12)::numeric, 1),
       ROUND((p.f0 - w * 0.3)::numeric, 1)   AS fpct,
       ROUND((p.m0 + w * 0.05)::numeric, 1)  AS mm,
       GREATEST(4, (p.vf0 - w / 2)::int),
       (p.mr0 - w * 5)::int,
       GREATEST(20, (p.ba0 - w / 2)::int),
       ROUND((p.w0 * 0.55 - w * 0.1)::numeric, 1),
       ROUND((p.w0 * 0.16 - w * 0.02)::numeric, 1),
       ROUND((p.w0 * 0.045 - w * 0.005)::numeric, 1),
       jsonb_build_object(
           'la', ROUND(((p.m0 + w * 0.05) * 0.05)::numeric, 1),
           'ra', ROUND(((p.m0 + w * 0.05) * 0.05)::numeric, 1),
           'tr', ROUND(((p.m0 + w * 0.05) * 0.50)::numeric, 1),
           'll', ROUND(((p.m0 + w * 0.05) * 0.20)::numeric, 1),
           'rl', ROUND(((p.m0 + w * 0.05) * 0.20)::numeric, 1)
       ),
       jsonb_build_object(
           'la', ROUND(((p.w0 - w * 0.4) * (p.f0 - w * 0.3) / 100 * 0.07)::numeric, 1),
           'ra', ROUND(((p.w0 - w * 0.4) * (p.f0 - w * 0.3) / 100 * 0.07)::numeric, 1),
           'tr', ROUND(((p.w0 - w * 0.4) * (p.f0 - w * 0.3) / 100 * 0.54)::numeric, 1),
           'll', ROUND(((p.w0 - w * 0.4) * (p.f0 - w * 0.3) / 100 * 0.16)::numeric, 1),
           'rl', ROUND(((p.w0 - w * 0.4) * (p.f0 - w * 0.3) / 100 * 0.16)::numeric, 1)
       ),
       'matched',
       :tid
FROM (VALUES
    (:alice_pid, 68.5, 26.1, 32.4, 40.2, 10, 1380, 42),
    (:bob_pid,   82.3, 28.9, 27.8, 56.1, 13, 1750, 45),
    (:carol_pid, 60.2, 24.5, 29.6, 38.0,  9, 1320, 38)
) AS p(pid, w0, b0, f0, m0, vf0, mr0, ba0)
CROSS JOIN generate_series(0, 7) AS w;

-- Food logs：過去 3 天 × 3 餐 × 3 位病患 = 27 筆
INSERT INTO food_logs
    (patient_id, logged_at, meal_type, food_items,
     total_calories, total_protein, total_carbs, total_fat,
     ai_suggestion, tenant_id)
SELECT p.pid,
       (CURRENT_DATE - d * INTERVAL '1 day') + m.t,
       m.meal,
       m.items::jsonb,
       m.kcal, m.prot, m.carb, m.fat,
       '[SEED] 蛋白質攝取穩定，持續保持',
       :tid
FROM (VALUES (:alice_pid), (:bob_pid), (:carol_pid)) AS p(pid)
CROSS JOIN generate_series(0, 2) AS d
CROSS JOIN (VALUES
    ('breakfast', TIME '08:00',
     '[{"name":"燕麥粥","qty":"1 碗"},{"name":"水煮蛋","qty":"1 顆"},{"name":"無糖豆漿","qty":"300ml"}]',
     320, 18, 42, 8),
    ('lunch', TIME '12:30',
     '[{"name":"雞胸肉沙拉","qty":"1 盤"},{"name":"糙米飯","qty":"半碗"},{"name":"燙青菜","qty":"1 份"}]',
     520, 38, 55, 15),
    ('dinner', TIME '18:30',
     '[{"name":"烤鮭魚","qty":"150g"},{"name":"花椰菜","qty":"1 盤"},{"name":"地瓜","qty":"1 條"}]',
     480, 32, 30, 24)
) AS m(meal, t, items, kcal, prot, carb, fat);

-- Visits：每位病患一次過去 + 一次計劃中 next_visit_date
INSERT INTO visits (patient_id, visit_date, doctor_id, notes, next_visit_date, tenant_id) VALUES
    (:alice_pid, CURRENT_DATE - 42, 'SEED-DR-01', '[SEED] 初次評估，BMI 偏高，擬訂 3 個月減脂計畫',  CURRENT_DATE - 14, :tid),
    (:alice_pid, CURRENT_DATE - 14, 'SEED-DR-01', '[SEED] 追蹤：體脂 -1.2%，飲食配合度佳',           CURRENT_DATE + 14, :tid),
    (:bob_pid,   CURRENT_DATE - 40, 'SEED-DR-02', '[SEED] 初診：血壓 140/90，開始生活型態調整',      CURRENT_DATE - 10, :tid),
    (:bob_pid,   CURRENT_DATE - 10, 'SEED-DR-02', '[SEED] 血壓 132/85，維持藥物劑量',                CURRENT_DATE + 20, :tid),
    (:carol_pid, CURRENT_DATE -  7, 'SEED-DR-01', '[SEED] 維持期：體重穩定，補充 Vit D',             CURRENT_DATE + 30, :tid);

-- Medications：綁在每位病患最近一次 visit
INSERT INTO medications (visit_id, drug_name, frequency, days, start_date, end_date, tenant_id)
SELECT v.id, m.drug, m.freq, m.d, v.visit_date, v.visit_date + m.d, :tid
FROM visits v
JOIN (VALUES
    (:alice_pid, '[SEED] Metformin 500mg', 'BID', 30),
    (:bob_pid,   '[SEED] Lisinopril 10mg', 'QD',  30),
    (:carol_pid, '[SEED] VitaminD3 1000IU','QD',  60)
) AS m(pid, drug, freq, d) ON m.pid = v.patient_id
WHERE v.tenant_id = :tid
  AND v.visit_date > CURRENT_DATE - 30;

-- Notification rules
INSERT INTO notification_rules
    (patient_id, type, days_before, interval_days, send_time, active, tenant_id) VALUES
    (:alice_pid, 'visit_reminder', 1,    NULL, '09:00', true, :tid),
    (:bob_pid,   'medication',     NULL, 1,    '08:30', true, :tid),
    (:carol_pid, 'follow_up',      3,    NULL, '10:00', true, :tid);

-- InBody pending：擺兩筆讓 /admin/inbody-pending 頁面有東西可以操作
INSERT INTO inbody_pending
    (uploaded_by, image_url, ocr_name, ocr_birth_date, ocr_chart_no, ocr_data,
     status, uploaded_at, tenant_id) VALUES
    (:staff_eid,
     'https://example.com/seed-inbody-unmatched.jpg',
     '王小明', '1985-05-05', NULL,
     '{"weight":78.0,"bmi":27.3,"body_fat":29.5}'::jsonb,
     'unmatched',
     NOW() - INTERVAL '2 days',
     :tid),
    (:staff_eid,
     'https://example.com/seed-inbody-ambiguous.jpg',
     'Alice Wang', '1985-03-12', NULL,
     '{"weight":67.8,"bmi":25.9,"body_fat":31.8}'::jsonb,
     'ambiguous',
     NOW() - INTERVAL '1 day',
     :tid);

COMMIT;
SQL

    reload_auth_engine
    echo "✓ seed 完成！"
    echo ""
    echo "  登入： http://localhost:8080/admin/login"
    echo "  帳號： admin@seed.test / $SEED_PW     （role=admin）"
    echo "        nutri@seed.test / $SEED_PW     （role=nutritionist）"
    echo "        staff@seed.test / $SEED_PW     （role=staff）"
    echo "        alice@seed.test / $SEED_PW     （role=patient）"
    echo "        bob@seed.test   / $SEED_PW     （role=patient）"
    echo "        carol@seed.test / $SEED_PW     （role=patient）"
    echo ""
    echo "  如果你之前已經以舊的 seed 帳號登入過，瀏覽器的 cookie 會指向已被刪掉的 user_id，"
    echo "  記得先清 localhost 的 cookie 再登入。"
}

# ────────────────────────────────────────────────────
# status
# ────────────────────────────────────────────────────
cmd_status() {
    echo "# seed 租戶 (tenant_id=$SEED_TID) 目前狀態"
    echo ""
    echo "## auth_db"
    psql_auth -v tid="$SEED_TID" <<'SQL'
SELECT
    (SELECT COUNT(*) FROM tenants           WHERE id        = :tid) AS tenants,
    (SELECT COUNT(*) FROM tenant_services   WHERE tenant_id = :tid) AS tenant_services,
    (SELECT COUNT(*) FROM tenant_roles      WHERE tenant_id = :tid) AS tenant_roles,
    (SELECT COUNT(*) FROM users             WHERE tenant_id = :tid) AS users,
    (SELECT COUNT(*) FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id   WHERE u.tenant_id = :tid) AS auth_identities;
SQL

    echo "## app_db"
    psql_app -v tid="$SEED_TID" <<'SQL'
SET app.bypass_rls = 'true';
SELECT
    (SELECT COUNT(*) FROM employees          WHERE tenant_id = :tid) AS employees,
    (SELECT COUNT(*) FROM patients           WHERE tenant_id = :tid) AS patients,
    (SELECT COUNT(*) FROM patient_goals      WHERE tenant_id = :tid) AS patient_goals,
    (SELECT COUNT(*) FROM inbody_records     WHERE tenant_id = :tid) AS inbody_records,
    (SELECT COUNT(*) FROM inbody_pending     WHERE tenant_id = :tid) AS inbody_pending,
    (SELECT COUNT(*) FROM food_logs          WHERE tenant_id = :tid) AS food_logs,
    (SELECT COUNT(*) FROM visits             WHERE tenant_id = :tid) AS visits,
    (SELECT COUNT(*) FROM medications        WHERE tenant_id = :tid) AS medications,
    (SELECT COUNT(*) FROM notification_rules WHERE tenant_id = :tid) AS notification_rules,
    (SELECT COUNT(*) FROM notification_logs  WHERE tenant_id = :tid) AS notification_logs;
SQL
}

# ────────────────────────────────────────────────────
# dispatch
# ────────────────────────────────────────────────────
require_pg

case "${1:-}" in
    apply)  cmd_apply ;;
    clean)  cmd_clean ;;
    reset)  cmd_clean; cmd_apply ;;
    status) cmd_status ;;
    *)
        echo "usage: $0 {apply|clean|reset|status}" >&2
        exit 1
        ;;
esac
