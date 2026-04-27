#!/usr/bin/env bash
# main_service 多租戶隔離測試 — 以兩個 clinic-admin 分別屬於不同 tenant，
# 驗證跨租戶讀寫都被擋掉（auth layer 的 resource ARN + main_service 的 tenant_id filter）。
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash main_service/tests/tenant_isolation.sh
#
# 設計取向：
#   - main_service 不直連 auth_db；所有 auth 端的建立 / 清理都透過 admin API。
#     （decoupling 原則：service 邊界內才直接 psql）
#   - app_db 的 patients / RLS 測試本來就是主題，psql_app 保留。
#   - 租戶 slug 帶 timestamp 避免重跑衝突；尾端透過 admin API 軟刪租戶 + 硬刪
#     自己建的 patients / food_logs；users 因 admin API 只做 soft-delete，留在 DB
#     但 active=false 無法再被使用。

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
STAMP=$(date +%s)
SLUG_A="iso-test-a-$STAMP"
SLUG_B="iso-test-b-$STAMP"

SUPER_COOKIE=$(mktemp)
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
trap 'rm -f "$SUPER_COOKIE" "$COOKIE_A" "$COOKIE_B"' EXIT

PASS=0
FAIL=0

assert_eq() {
    if [[ "$2" == "$3" ]]; then
        echo "  ✓ $1"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $1 — expected=$2 actual=$3"
        FAIL=$((FAIL + 1))
    fi
}

status() {
    curl -s -o /dev/null -w "%{http_code}" "$@"
}

j() {
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"
}

psql_app() {
    docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d app_db -tA -c "$1" | head -1
}

# ── 以 super_admin 身份登入做後台設定 ──────────
echo "── super_admin 登入 ──"
curl -s -c "$SUPER_COOKIE" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" -d '{}' >/dev/null

# ── 建兩個 tenant（slug 帶 timestamp，不會撞）──
echo "── 建立 tenant $SLUG_A / $SLUG_B ──"
tA=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/tenants" \
    -H "Content-Type: application/json" \
    -d "{\"slug\":\"$SLUG_A\",\"name\":\"Iso Test A\"}" | j "['id']")
tB=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/tenants" \
    -H "Content-Type: application/json" \
    -d "{\"slug\":\"$SLUG_B\",\"name\":\"Iso Test B\"}" | j "['id']")
echo "  tenant A id=$tA, tenant B id=$tB"

# ── 各 tenant 建一個 clinic-admin user（未綁 LINE，但能以 dev-login 模擬）──
echo "── 建立兩個 clinic-admin user ──"
uAdmA=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/users" \
    -H "Content-Type: application/json" \
    -d "{\"display_name\":\"iso-adm-a\",\"role\":\"admin\",\"tenant_id\":$tA}" | j "['user_id']")
uAdmB=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/users" \
    -H "Content-Type: application/json" \
    -d "{\"display_name\":\"iso-adm-b\",\"role\":\"admin\",\"tenant_id\":$tB}" | j "['user_id']")
echo "  admin A user_id=$uAdmA, admin B user_id=$uAdmB"

# ── 在 app_db 各塞一個 patient row 屬於對應 tenant ──
echo "── app_db 建立兩筆 patient ──"
pA=$(psql_app "INSERT INTO patients (name, birth_date, tenant_id) VALUES ('Iso A', '1990-01-01', $tA) RETURNING id;")
pB=$(psql_app "INSERT INTO patients (name, birth_date, tenant_id) VALUES ('Iso B', '1990-01-01', $tB) RETURNING id;")
echo "  patient A id=$pA, patient B id=$pB"

# ── 以 admin A 身份登入 ────────────────────────
curl -s -c "$COOKIE_A" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":$uAdmA}" >/dev/null

# ── 以 admin B 身份登入 ────────────────────────
curl -s -c "$COOKIE_B" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":$uAdmB}" >/dev/null

echo
echo "── 測試 1：adminA 讀自己 tenant 的 patient ──"
code=$(status -b "$COOKIE_A" "$BASE/api/v1/patients/$pA")
assert_eq "adminA GET /api/patients/(A) 應 200" "200" "$code"

echo "── 測試 2：adminA 讀 tenant B 的 patient（跨租戶）──"
code=$(status -b "$COOKIE_A" "$BASE/api/v1/patients/$pB")
assert_eq "adminA GET /api/patients/(B) 應 404（tenant filter 擋下）" "404" "$code"

echo "── 測試 3：adminA GET /api/patients 列表只看得到 tenant A ──"
resp=$(curl -s -b "$COOKIE_A" "$BASE/api/v1/patients")
tenants=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sorted({p['tenant_id'] for p in d['patients']}))")
assert_eq "adminA 列表只含 tenant A ($tA)" "[$tA]" "$tenants"

echo "── 測試 4：adminB 讀 tenant A 的 patient（反向交叉驗證）──"
code=$(status -b "$COOKIE_B" "$BASE/api/v1/patients/$pA")
assert_eq "adminB GET /api/patients/(A) 應 404" "404" "$code"

echo "── 測試 5：adminB GET /api/patients 列表只看得到 tenant B ──"
resp=$(curl -s -b "$COOKIE_B" "$BASE/api/v1/patients")
tenants=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sorted({p['tenant_id'] for p in d['patients']}))")
assert_eq "adminB 列表只含 tenant B ($tB)" "[$tB]" "$tenants"

echo "── 測試 6：super_admin 從業務 API 讀 tenant 資料應被 main_service 擋下 ──"
# IAM policy 允許（*:*），但 main_service 的 WHERE tenant_id=0 filter 擋下 →
# 這是設計上的 defence-in-depth：super_admin 只做 auth 管理，不該從業務 API 跨越 tenant。
code=$(status -b "$SUPER_COOKIE" "$BASE/api/v1/patients/$pA")
assert_eq "super_admin GET /api/patients/(A) 應 404（tenant filter 擋）" "404" "$code"
code=$(status -b "$SUPER_COOKIE" "$BASE/api/v1/patients/$pB")
assert_eq "super_admin GET /api/patients/(B) 應 404" "404" "$code"

# helper：psql 做完整 transaction，抓最後一個純數字行作為 COUNT 結果
psql_count() {
    docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d app_db -tAq -c "$1" 2>&1 \
        | grep -E '^[0-9]+$' | tail -1
}

echo "── 測試 7：RLS 本身 — 以 app_user + tenant A 環境直接 SELECT ──"
# 以下 3 支測試本質上是驗 PostgreSQL RLS 行為（app_db 自己的功能），
# 必須走 psql，沒有對應 HTTP API。這是 app_db 內部測試，沒違反 service 解耦。
visible=$(psql_count "
    BEGIN;
    SET LOCAL ROLE app_user;
    SELECT set_config('app.current_tenant', '$tA', true);
    SELECT COUNT(*) FROM patients WHERE id IN ($pA, $pB);
    COMMIT;
")
assert_eq "RLS 在 tenant A 下只見 1 筆（patient A）" "1" "$visible"

visible_b=$(psql_count "
    BEGIN;
    SET LOCAL ROLE app_user;
    SELECT set_config('app.current_tenant', '$tB', true);
    SELECT COUNT(*) FROM patients WHERE id IN ($pA, $pB);
    COMMIT;
")
assert_eq "RLS 在 tenant B 下只見 1 筆（patient B）" "1" "$visible_b"

echo "── 測試 8：RLS 阻擋跨租戶 INSERT ──"
set +e
insert_output=$(docker compose -f docker-compose.dev.yml exec -T postgres \
    psql -U postgres -d app_db -tAq -c "
    BEGIN;
    SET LOCAL ROLE app_user;
    SELECT set_config('app.current_tenant', '$tA', true);
    INSERT INTO patients (name, birth_date, tenant_id) VALUES ('forbidden', '1990-01-01', $tB);
    COMMIT;
    " 2>&1)
set -e
if echo "$insert_output" | grep -iq "row-level security"; then
    assert_eq "跨租戶 INSERT 撞 WITH CHECK" "blocked" "blocked"
else
    assert_eq "跨租戶 INSERT 撞 WITH CHECK" "blocked" "NOT blocked — output: $insert_output"
fi

echo "── 測試 9：RLS bypass context 能跨租戶 ──"
visible_all=$(psql_count "
    BEGIN;
    SET LOCAL ROLE app_user;
    SELECT set_config('app.bypass_rls', 'true', true);
    SELECT COUNT(*) FROM patients WHERE id IN ($pA, $pB);
    COMMIT;
")
assert_eq "bypass_rls=true 時兩筆都見（for 排程）" "2" "$visible_all"

# ── 清掉測試資料 ───────────────────────────────
# app_db 的 patients / food_logs 是本服務的東西，用 psql_app 清。
# auth_db 端透過 admin API：user soft-delete + tenant 停用（slug 帶 timestamp
# 所以舊 row 留著也不會跟下次衝突，免去 auth_db 直接 DELETE 的需要）。
echo
echo "── 清掉測試資料 ──"
psql_app "DELETE FROM food_logs WHERE tenant_id IN ($tA, $tB);" >/dev/null || true
psql_app "DELETE FROM patients  WHERE tenant_id IN ($tA, $tB);" >/dev/null

for uid in "$uAdmA" "$uAdmB"; do
    curl -s -b "$SUPER_COOKIE" -X DELETE "$BASE/auth/v1/admin/users/$uid" >/dev/null || true
done
for tid in "$tA" "$tB"; do
    curl -s -b "$SUPER_COOKIE" -X DELETE "$BASE/auth/v1/admin/tenants/$tid" >/dev/null || true
done

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
