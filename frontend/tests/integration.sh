#!/usr/bin/env bash
# frontend 整合測試 — 透過 nginx 驗證 page-level guard
#
# 覆蓋：
#   1. /admin/* 進入條件：未登入 → 302；patient → 403；clinic-admin / super_admin → 200
#   2. /patient/* 進入條件（Nginx /auth/verify-page）：未登入 → 302；登入即放行
#   3. /admin/login 與 / 不擋
#
# 測試資料透過 admin API 建，trap 硬刪 tenant + users 避免殘留。
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash frontend/tests/integration.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER_COOKIE=$(mktemp)
ADMIN_COOKIE=$(mktemp)
PATIENT_COOKIE=$(mktemp)

cleanup() {
    # 用 slug=fe-test 定位測試資料，硬刪（包含 RLS revoke keys）
    local uids tid
    uids=$(docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -qAtc \
        "SELECT id FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug='fe-test');" 2>/dev/null)
    for uid in $uids; do
        docker compose -f docker-compose.dev.yml exec -T redis redis-cli DEL "auth:user_revoke:$uid" >/dev/null 2>&1 || true
    done
    tid=$(docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -qAtc "SELECT id FROM tenants WHERE slug='fe-test';" 2>/dev/null)
    if [[ -n "$tid" ]]; then
        docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -qAtc "
            DELETE FROM users WHERE tenant_id = $tid;
            DELETE FROM tenant_services WHERE tenant_id = $tid;
            DELETE FROM tenant_roles WHERE tenant_id = $tid;
            DELETE FROM tenants WHERE id = $tid;
        " >/dev/null 2>&1 || true
    fi
    rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE" "$PATIENT_COOKIE"
}
trap cleanup EXIT

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

status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }

# 跑之前先確認沒有殘留
cleanup 2>/dev/null || true
# 但 cookie 檔還要用，重新 mktemp
SUPER_COOKIE=$(mktemp); ADMIN_COOKIE=$(mktemp); PATIENT_COOKIE=$(mktemp)

echo "── seed: tenant + admin + patient（透過 admin API）──"
curl -s -c "$SUPER_COOKIE" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" -d '{}' >/dev/null
tid=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/tenants" \
    -H "Content-Type: application/json" \
    -d '{"slug":"fe-test","name":"FE Test"}' | jget "['id']")
uAdmin=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/users" \
    -H "Content-Type: application/json" \
    -d "{\"display_name\":\"fe-admin\",\"role\":\"admin\",\"tenant_id\":$tid}" | jget "['user_id']")
uPatient=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/users" \
    -H "Content-Type: application/json" \
    -d "{\"display_name\":\"fe-patient\",\"role\":\"patient\",\"tenant_id\":$tid}" | jget "['user_id']")
echo "  tenant=$tid admin=$uAdmin patient=$uPatient"

# 直接 dev-login 到特定 user（不需 LINE bind）
curl -s -c "$ADMIN_COOKIE"   -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" -d "{\"user_id\":$uAdmin}" >/dev/null
curl -s -c "$PATIENT_COOKIE" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" -d "{\"user_id\":$uPatient}" >/dev/null

echo "── 後台頁面 guard（/admin/*）──"
code=$(status "$BASE/admin/users")
assert_eq "未登入 /admin/users → 302 (→ /admin/login)" "302" "$code"

code=$(status -b "$PATIENT_COOKIE" "$BASE/admin/users")
assert_eq "patient → 403" "403" "$code"

code=$(status -b "$ADMIN_COOKIE" "$BASE/admin/users")
assert_eq "clinic-admin → 200 (admin:view 放行)" "200" "$code"

code=$(status -b "$SUPER_COOKIE" "$BASE/admin/users")
assert_eq "super_admin → 200" "200" "$code"

code=$(status -b "$SUPER_COOKIE" "$BASE/admin/patients")
assert_eq "super_admin 可訪 /admin/patients" "200" "$code"

code=$(status -b "$SUPER_COOKIE" "$BASE/admin/roles")
assert_eq "super_admin 可訪 /admin/roles" "200" "$code"

code=$(status -b "$ADMIN_COOKIE" "$BASE/admin/roles")
assert_eq "clinic-admin 可訪 /admin/roles（frontend 層統一放行）" "200" "$code"

echo "── 病患頁面 guard（/patient/*，verify-page 輕量）──"
code=$(status "$BASE/patient/food-logs")
assert_eq "未登入 /patient/food-logs → 302 (→ /liff)" "302" "$code"

code=$(status -b "$PATIENT_COOKIE" "$BASE/patient/food-logs")
assert_eq "patient 登入後 → 200" "200" "$code"

code=$(status -b "$ADMIN_COOKIE" "$BASE/patient/food-logs")
assert_eq "clinic-admin 也能進病患頁（只檢登入）" "200" "$code"

echo "── 前端非 guard 頁面 ──"
code=$(status "$BASE/")
assert_eq "首頁 / 無需登入" "200" "$code"

code=$(status "$BASE/admin/login")
assert_eq "/admin/login 無需登入（不擋）" "200" "$code"

code=$(status "$BASE/liff")
assert_eq "/liff 入口無需登入" "200" "$code"

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
