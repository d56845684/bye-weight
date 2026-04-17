#!/usr/bin/env bash
# main_service 整合測試 — 透過 nginx 打 /api/*
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash main_service/tests/integration.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

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

# 以 super_admin 身份登入（有 patient:manage 權限）
curl -s -c "$COOKIE" -X POST "$BASE/auth/dev-login" \
    -H "Content-Type: application/json" -d '{}' >/dev/null

echo "── 1. /api/patients 無 cookie = 401 ──"
code=$(status "$BASE/api/patients")
assert_eq "無 cookie 應 401" "401" "$code"

echo "── 2. /api/patients 帶 cookie = 200 ──"
code=$(status -b "$COOKIE" "$BASE/api/patients")
assert_eq "帶 cookie 應 200" "200" "$code"

echo "── 3. /api/patients 回應為 JSON 且含 patients 欄位 ──"
resp=$(curl -s -b "$COOKIE" "$BASE/api/patients")
has_key=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'patients' in d else 'no')")
assert_eq "回應含 patients key" "yes" "$has_key"

echo "── 4. /api/patients/999 不存在 = 404 ──"
code=$(status -b "$COOKIE" "$BASE/api/patients/999")
assert_eq "不存在病患應 404" "404" "$code"

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
