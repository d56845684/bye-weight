#!/usr/bin/env bash
# auth_service session smoke test — 透過 nginx 覆蓋基本身份流程：
#   1. Health
#   2. 未帶 cookie → 401
#   3. dev-login (super_admin 預設) + /auth/me
#   4. /auth/me/permissions (actions=["*"])
#   5. Password login（有效 / 錯密碼 / 未知 email）
#   6. Logout 後 token 立即撤銷
#
# IAM / tenant / role CRUD 的細節由 admin_crud.sh / permissions.sh /
# policy_tenant_scope.sh 各自覆蓋；這支只看 session 層是否健康。
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash auth_service/tests/integration.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER_COOKIE=$(mktemp)
PW_COOKIE=$(mktemp)
trap 'rm -f "$SUPER_COOKIE" "$PW_COOKIE"' EXIT

PASS=0
FAIL=0

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  ✓ $label"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $label — expected=$expected actual=$actual"
        FAIL=$((FAIL + 1))
    fi
}

status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "── 1. health ──"
code=$(status "$BASE/auth/v1/health")
assert_eq "/auth/health 回 200" "200" "$code"

echo "── 2. 無 cookie 打受保護端點 ──"
code=$(status "$BASE/api/v1/patients")
assert_eq "無 cookie 打 /api/patients 應 401" "401" "$code"
code=$(status "$BASE/auth/v1/me")
assert_eq "無 cookie 打 /auth/me 應 401" "401" "$code"

echo "── 3. dev-login (預設 super_admin) ──"
resp=$(curl -s -c "$SUPER_COOKIE" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" -d '{}')
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
tenant=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant_id'])")
assert_eq "預設登入角色為 super_admin" "super_admin" "$role"
assert_eq "super_admin tenant_id=0" "0" "$tenant"

resp=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/v1/me")
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
assert_eq "/auth/me 回 super_admin" "super_admin" "$role"

echo "── 4. /auth/me/permissions 回 actions=[\"*\"] ──"
actions=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/v1/me/permissions" \
    | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['actions']))")
assert_eq "super_admin 可打全系統" '["*"]' "$actions"

echo "── 5. 密碼登入 ──"
resp=$(curl -s -c "$PW_COOKIE" -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@dev.local","password":"admin123"}')
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('role',''))")
assert_eq "正確密碼登入回 super_admin" "super_admin" "$role"

code=$(status -b "$PW_COOKIE" "$BASE/admin/users")
assert_eq "密碼登入後可訪問 /admin/users" "200" "$code"

code=$(status -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@dev.local","password":"wrong"}')
assert_eq "錯密碼回 401" "401" "$code"

code=$(status -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ghost@dev.local","password":"admin123"}')
assert_eq "不存在 email 回 401" "401" "$code"

echo "── 6. logout 後 token 立即撤銷 ──"
curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/logout" >/dev/null
code=$(status -b "$SUPER_COOKIE" "$BASE/auth/v1/me")
assert_eq "logout 後 /auth/me 應 401" "401" "$code"

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
