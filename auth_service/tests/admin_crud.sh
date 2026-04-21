#!/usr/bin/env bash
# auth_service admin backoffice 整合測試 — 透過 nginx 驗證：
#   1. action_mappings CRUD（super_admin 可；clinic-admin 被擋）
#   2. clinic-admin /admin/users 只看自己 tenant（原 403 bug 回歸檢查）
#   3. patient invite flow（clinic-admin 可邀請；staff 預設不可）
#   4. super_admin 可設 user email/password，之後能密碼登入
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash auth_service/tests/admin_crud.sh
#
# 測試資料用 slug=admin-test 的 tenant 獨立管理，開頭會先清除殘留。

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER=$(mktemp)
CLINIC=$(mktemp)
STAFF=$(mktemp)
trap 'rm -f "$SUPER" "$CLINIC" "$STAFF"' EXIT

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

status() {
    curl -s -o /dev/null -w "%{http_code}" "$@"
}

jget() {
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"
}

psql_auth() {
    docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -tA -c "$1" | head -1
}

# ── 0. 清理上次殘留 ─────────────────────────────
echo "── 0. 清理舊測試資料 ──"
old_tid=$(psql_auth "SELECT id FROM tenants WHERE slug='admin-test';" || echo "")
if [[ -n "$old_tid" ]]; then
    psql_auth "DELETE FROM users WHERE tenant_id=$old_tid;" >/dev/null || true
    psql_auth "DELETE FROM tenant_services WHERE tenant_id=$old_tid;" >/dev/null || true
    psql_auth "DELETE FROM tenant_roles WHERE tenant_id=$old_tid;" >/dev/null || true
    psql_auth "DELETE FROM tenants WHERE id=$old_tid;" >/dev/null || true
fi
# 清掉前一次遺留的 test-mapping（若有）
psql_auth "DELETE FROM action_mappings WHERE url_pattern = '/auth/v1/admin/test-mapping';" >/dev/null || true

# ── 1. super_admin 登入 ────────────────────────
echo
echo "── 1. super_admin dev-login ──"
curl -s -c "$SUPER" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" -d '{}' >/dev/null
code=$(status -b "$SUPER" "$BASE/auth/v1/me")
assert_eq "super_admin /me 回 200" "200" "$code"

# ── 2. 建測試 tenant + clinic-admin + staff ────
echo
echo "── 2. 測試資料：建 tenant / clinic-admin / staff ──"
tid=$(curl -s -b "$SUPER" -X POST "$BASE/auth/v1/admin/tenants" \
    -H "Content-Type: application/json" \
    -d '{"slug":"admin-test","name":"Admin Test"}' | jget "['id']")
echo "  tenant id=$tid"

uAdmin=$(curl -s -b "$SUPER" -X POST "$BASE/auth/v1/admin/users" \
    -H "Content-Type: application/json" \
    -d "{\"display_name\":\"test-admin\",\"role\":\"admin\",\"tenant_id\":$tid}" \
    | jget "['user_id']")
uStaff=$(curl -s -b "$SUPER" -X POST "$BASE/auth/v1/admin/users" \
    -H "Content-Type: application/json" \
    -d "{\"display_name\":\"test-staff\",\"role\":\"staff\",\"tenant_id\":$tid}" \
    | jget "['user_id']")
echo "  clinic-admin id=$uAdmin, staff id=$uStaff"

curl -s -c "$CLINIC" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":$uAdmin}" >/dev/null
curl -s -c "$STAFF" -X POST "$BASE/auth/v1/dev-login" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":$uStaff}" >/dev/null

# ── 3. action_mappings CRUD（super_admin 可）──
echo
echo "── 3. action_mappings CRUD（super_admin）──"
code=$(status -b "$SUPER" "$BASE/auth/v1/admin/action-mappings")
assert_eq "GET /admin/action-mappings 200" "200" "$code"

total=$(curl -s -b "$SUPER" "$BASE/auth/v1/admin/action-mappings" \
    | python3 -c "import sys,json; m=json.load(sys.stdin)['mappings']; print('ok' if len(m)>0 else 'empty')")
assert_eq "list 至少 1 筆" "ok" "$total"

adm_count=$(curl -s -b "$SUPER" "$BASE/auth/v1/admin/action-mappings?service=admin" \
    | python3 -c "import sys,json; m=json.load(sys.stdin)['mappings']; print('ok' if len(m)>0 else 'empty')")
assert_eq "?service=admin 有結果" "ok" "$adm_count"

# 取 admin service id
admin_svc_id=$(curl -s -b "$SUPER" "$BASE/auth/v1/admin/services" \
    | python3 -c "import sys,json; [print(s['id']) for s in json.load(sys.stdin)['services'] if s['name']=='admin']")

# CREATE
create_resp=$(curl -s -b "$SUPER" -X POST "$BASE/auth/v1/admin/action-mappings" \
    -H "Content-Type: application/json" \
    -d "{\"service_id\":$admin_svc_id,\"http_method\":\"GET\",\"url_pattern\":\"/auth/v1/admin/test-mapping\",\"action\":\"admin:test:read\",\"resource_template\":\"admin:test\"}")
new_id=$(echo "$create_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','NONE'))")
[[ "$new_id" =~ ^[0-9]+$ ]] && result="ok" || result="FAIL ($create_resp)"
assert_eq "CREATE 返回 id" "ok" "$result"

# UPDATE
code=$(status -b "$SUPER" -X PATCH "$BASE/auth/v1/admin/action-mappings/$new_id" \
    -H "Content-Type: application/json" \
    -d '{"action":"admin:test:write"}')
assert_eq "PATCH 200" "200" "$code"

# DELETE
code=$(status -b "$SUPER" -X DELETE "$BASE/auth/v1/admin/action-mappings/$new_id")
assert_eq "DELETE 200" "200" "$code"

# 再 DELETE 同一個應該 404
code=$(status -b "$SUPER" -X DELETE "$BASE/auth/v1/admin/action-mappings/$new_id")
assert_eq "再次 DELETE 404" "404" "$code"

# ── 4. clinic-admin 被擋出 action-mappings ────
echo
echo "── 4. clinic-admin 無 admin:action-mapping:* 權限 ──"
code=$(status -b "$CLINIC" "$BASE/auth/v1/admin/action-mappings")
assert_eq "clinic-admin GET 403" "403" "$code"

code=$(status -b "$CLINIC" -X POST "$BASE/auth/v1/admin/action-mappings" \
    -H "Content-Type: application/json" \
    -d "{\"service_id\":1,\"http_method\":\"GET\",\"url_pattern\":\"/x\",\"action\":\"a:b:c\",\"resource_template\":\"r\"}")
assert_eq "clinic-admin POST 403" "403" "$code"

# ── 5. clinic-admin /admin/users 回歸測 ────────
echo
echo "── 5. clinic-admin /admin/users 只看自己 tenant（回歸 test）──"
code=$(status -b "$CLINIC" "$BASE/auth/v1/admin/users")
assert_eq "clinic-admin GET /admin/users 200" "200" "$code"

users_json=$(curl -s -b "$CLINIC" "$BASE/auth/v1/admin/users")
tenants=$(echo "$users_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sorted({u['tenant_id'] for u in d['users']}))")
assert_eq "clinic-admin 只看到 tenant [$tid]" "[$tid]" "$tenants"

# roles / tenants
code=$(status -b "$CLINIC" "$BASE/auth/v1/admin/roles")
assert_eq "clinic-admin GET /admin/roles 200" "200" "$code"

code=$(status -b "$CLINIC" "$BASE/auth/v1/admin/tenants")
assert_eq "clinic-admin GET /admin/tenants 403（不該列全 tenant）" "403" "$code"

# own tenant detail
code=$(status -b "$CLINIC" "$BASE/auth/v1/admin/tenants/$tid/roles")
assert_eq "clinic-admin 讀自己 tenant roles 200" "200" "$code"

# ── 6. patient invite（clinic-admin 可；staff 預設不可）──
echo
echo "── 6. /admin/users/invite 權限矩陣 ──"
invite_resp=$(curl -s -b "$CLINIC" -X POST "$BASE/auth/v1/admin/users/invite" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"邀請測試"}')
invited_id=$(echo "$invite_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user_id','ERR'))")
[[ "$invited_id" =~ ^[0-9]+$ ]] && invite_result="ok" || invite_result="FAIL ($invite_resp)"
assert_eq "clinic-admin invite 201" "ok" "$invite_result"

code=$(status -b "$STAFF" -X POST "$BASE/auth/v1/admin/users/invite" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"x"}')
assert_eq "staff invite 403（無 patient-inviter policy）" "403" "$code"

# ── 7. 跨 tenant 防禦：clinic-admin 不能改別 tenant 的 user ──
#       必須在設密碼（會 RevokeUser）之前執行，否則 cookie 已被吊銷。
echo
echo "── 7. clinic-admin 不能修改別 tenant 的 user ──"
# 借用 id=1（dev super_admin，不在 test tenant）
code=$(status -b "$CLINIC" -X PATCH "$BASE/auth/v1/admin/users/1" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"hacked"}')
assert_eq "clinic-admin PATCH 別 tenant 的 user 回 404" "404" "$code"

code=$(status -b "$CLINIC" -X DELETE "$BASE/auth/v1/admin/users/1")
assert_eq "clinic-admin DELETE 別 tenant 的 user 回 404" "404" "$code"

# ── 8. SetUserPassword + 之後密碼登入 + RevokeUser 效果 ────
echo
echo "── 8. super_admin 設密碼後能登入，舊 session 失效 ──"
code=$(status -b "$SUPER" -X POST "$BASE/auth/v1/admin/users/$uAdmin/password" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin-test-'$uAdmin'@example.com","password":"test-pass-12345"}')
assert_eq "SetUserPassword 200" "200" "$code"

login_resp=$(curl -s -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"admin-test-$uAdmin@example.com\",\"password\":\"test-pass-12345\"}")
role=$(echo "$login_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('role','ERR'))")
assert_eq "密碼登入回 role=admin" "admin" "$role"

# 設完密碼後，舊的 CLINIC cookie 應該被 RevokeUser 吊銷。
# JWT iat 跟 revoke_ts 都是 Unix 秒數，兩段測試很快跑完可能同一秒，
# 比較式 iat < revoke_ts 可能失敗。等 1 秒確保差距。
sleep 1
# 用 SUPER 再戳一次 revoke 保證 ts 往前推
curl -s -b "$SUPER" -X POST "$BASE/auth/v1/admin/users/$uAdmin/password" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin-test-'$uAdmin'@example.com","password":"test-pass-12345"}' >/dev/null
code=$(status -b "$CLINIC" "$BASE/auth/v1/me")
assert_eq "SetPassword 後舊 session 401（RevokeUser 生效）" "401" "$code"

# ── 9. 清掉測試資料 ──────────────────────────
echo
echo "── 9. 清理測試資料 ──"
psql_auth "DELETE FROM users WHERE tenant_id=$tid;" >/dev/null
psql_auth "DELETE FROM tenant_services WHERE tenant_id=$tid;" >/dev/null
psql_auth "DELETE FROM tenant_roles WHERE tenant_id=$tid;" >/dev/null
psql_auth "DELETE FROM tenants WHERE id=$tid;" >/dev/null
psql_auth "DELETE FROM action_mappings WHERE url_pattern = '/auth/v1/admin/test-mapping';" >/dev/null || true

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
