#!/usr/bin/env bash
# frontend 整合測試 — 透過 nginx 驗證後台頁面 guard
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash frontend/tests/integration.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER_COOKIE=$(mktemp)
ADMIN_COOKIE=$(mktemp)
PATIENT_COOKIE=$(mktemp)
trap 'rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE" "$PATIENT_COOKIE"' EXIT

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

# seed clinic admin + dev-login 三種身份
docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -c "
INSERT INTO users (line_uuid, role_id, clinic_id, active)
VALUES ('test-clinic-admin', (SELECT id FROM roles WHERE name='admin'), 'C001', true)
ON CONFLICT (line_uuid) DO UPDATE SET role_id = EXCLUDED.role_id;
INSERT INTO users (line_uuid, role_id, clinic_id, patient_id, active)
VALUES ('test-patient', (SELECT id FROM roles WHERE name='patient'), 'C001', 1, true)
ON CONFLICT (line_uuid) DO UPDATE SET role_id = EXCLUDED.role_id;
" >/dev/null

curl -s -c "$SUPER_COOKIE"   -X POST "$BASE/auth/v1/dev-login" -H "Content-Type: application/json" -d '{}' >/dev/null
curl -s -c "$ADMIN_COOKIE"   -X POST "$BASE/auth/v1/dev-login" -H "Content-Type: application/json" -d '{"line_uuid":"test-clinic-admin"}' >/dev/null
curl -s -c "$PATIENT_COOKIE" -X POST "$BASE/auth/v1/dev-login" -H "Content-Type: application/json" -d '{"line_uuid":"test-patient"}' >/dev/null

echo "── 後台 guard（/admin/*）──"
code=$(status "$BASE/admin/users")
assert_eq "未登入 → 401" "401" "$code"

code=$(status -b "$PATIENT_COOKIE" "$BASE/admin/users")
assert_eq "patient → 403" "403" "$code"

code=$(status -b "$ADMIN_COOKIE" "$BASE/admin/users")
assert_eq "clinic admin → 403" "403" "$code"

code=$(status -b "$SUPER_COOKIE" "$BASE/admin/users")
assert_eq "super_admin → 200" "200" "$code"

code=$(status -b "$SUPER_COOKIE" "$BASE/admin/patients")
assert_eq "super_admin 可訪 /admin/patients" "200" "$code"

code=$(status -b "$SUPER_COOKIE" "$BASE/admin/roles")
assert_eq "super_admin 可訪 /admin/roles" "200" "$code"

code=$(status -b "$ADMIN_COOKIE" "$BASE/admin/roles")
assert_eq "clinic admin 不可訪 /admin/roles → 403" "403" "$code"

echo "── 前端非後台頁不受 guard ──"
code=$(status "$BASE/")
assert_eq "首頁 / 無需登入" "200" "$code"

code=$(status "$BASE/admin/login")
assert_eq "/admin/login 無需登入（不擋）" "200" "$code"

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
