#!/usr/bin/env bash
# auth_service 整合測試 — 透過 nginx 打完整流程
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash auth_service/tests/integration.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER_COOKIE=$(mktemp)
ADMIN_COOKIE=$(mktemp)
trap 'rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE"' EXIT

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

echo "── 1. health ──"
code=$(status "$BASE/auth/health")
assert_eq "/auth/health 回 200" "200" "$code"

echo "── 2. dev-login (super_admin 預設) ──"
resp=$(curl -s -c "$SUPER_COOKIE" -X POST "$BASE/auth/dev-login" \
    -H "Content-Type: application/json" -d '{}')
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
assert_eq "預設登入角色為 super_admin" "super_admin" "$role"

echo "── 3. /auth/me ──"
resp=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/me")
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
assert_eq "/auth/me 回 super_admin" "super_admin" "$role"

echo "── 4. verify 無 cookie = 401 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/patients")
assert_eq "無 cookie 打 /api/patients 應 401" "401" "$code"

echo "── 5. super_admin 讀 /auth/admin/users = 200 ──"
code=$(status -b "$SUPER_COOKIE" "$BASE/auth/admin/users")
assert_eq "super_admin 可讀 user 列表" "200" "$code"

echo "── 6. RBAC 擋 admin 讀 /auth/admin/users ──"
# seed 一個 role=admin 的 user
docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -c "
INSERT INTO users (line_uuid, role_id, clinic_id, active)
VALUES ('test-clinic-admin', (SELECT id FROM roles WHERE name='admin'), 'C001', true)
ON CONFLICT (line_uuid) DO UPDATE SET role_id = EXCLUDED.role_id;
" >/dev/null
curl -s -c "$ADMIN_COOKIE" -X POST "$BASE/auth/dev-login" \
    -H "Content-Type: application/json" -d '{"line_uuid":"test-clinic-admin"}' >/dev/null
code=$(status -b "$ADMIN_COOKIE" "$BASE/auth/admin/users")
assert_eq "admin 讀 /auth/admin/users 應 403" "403" "$code"
code=$(status -b "$ADMIN_COOKIE" "$BASE/admin/users")
assert_eq "admin 看 /admin/users 前端頁 應 403" "403" "$code"

echo "── 7. 密碼登入 ──"
PW_COOKIE=$(mktemp)
resp=$(curl -s -c "$PW_COOKIE" -X POST "$BASE/auth/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@dev.local","password":"admin123"}')
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('role',''))")
assert_eq "正確密碼登入回 super_admin" "super_admin" "$role"

code=$(status -b "$PW_COOKIE" "$BASE/admin/users")
assert_eq "密碼登入後可訪問 /admin/users" "200" "$code"

code=$(status -X POST "$BASE/auth/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@dev.local","password":"wrong"}')
assert_eq "錯密碼回 401" "401" "$code"

code=$(status -X POST "$BASE/auth/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ghost@dev.local","password":"admin123"}')
assert_eq "不存在 email 回 401" "401" "$code"
rm -f "$PW_COOKIE"

echo "── 8. 角色 CRUD + 權限 assignment ──"
# list roles
resp=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/roles")
super_locked=$(echo "$resp" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([r for r in d['roles'] if r['name']=='super_admin'][0]['locked'])
")
assert_eq "super_admin 標記為 locked" "True" "$super_locked"

# create new role
code=$(status -b "$SUPER_COOKIE" -X POST "$BASE/auth/admin/roles" \
    -H "Content-Type: application/json" -d '{"name":"doctor_test"}')
assert_eq "建立 doctor_test 回 201" "201" "$code"

# duplicate → 409
code=$(status -b "$SUPER_COOKIE" -X POST "$BASE/auth/admin/roles" \
    -H "Content-Type: application/json" -d '{"name":"doctor_test"}')
assert_eq "重複名稱回 409" "409" "$code"

# invalid name → 400
code=$(status -b "$SUPER_COOKIE" -X POST "$BASE/auth/admin/roles" \
    -H "Content-Type: application/json" -d '{"name":"BAD NAME"}')
assert_eq "不合法名稱回 400" "400" "$code"

# 取得 doctor_test id
doc_id=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/roles" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([r['id'] for r in d['roles'] if r['name']=='doctor_test'][0])
")

# 查 inbody:read 的 id，指派給 doctor_test
pid=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/permissions" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([p['id'] for p in d['permissions'] if p['name']=='inbody:read'][0])
")
code=$(status -b "$SUPER_COOKIE" -X PUT "$BASE/auth/admin/roles/$doc_id/permissions" \
    -H "Content-Type: application/json" -d "{\"permission_ids\":[$pid]}")
assert_eq "指派權限回 200" "200" "$code"

# 讀回來驗證
got=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/roles/$doc_id/permissions" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['permission_ids'])")
assert_eq "讀回的 permission_ids" "[$pid]" "$got"

# super_admin 改權限 → 423
super_id=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/roles" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([r['id'] for r in d['roles'] if r['name']=='super_admin'][0])
")
code=$(status -b "$SUPER_COOKIE" -X PUT "$BASE/auth/admin/roles/$super_id/permissions" \
    -H "Content-Type: application/json" -d '{"permission_ids":[]}')
assert_eq "改 super_admin 權限回 423" "423" "$code"

# 刪 super_admin → 423
code=$(status -b "$SUPER_COOKIE" -X DELETE "$BASE/auth/admin/roles/$super_id")
assert_eq "刪 super_admin 回 423" "423" "$code"

# 刪 patient → 423
patient_id=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/roles" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([r['id'] for r in d['roles'] if r['name']=='patient'][0])
")
code=$(status -b "$SUPER_COOKIE" -X DELETE "$BASE/auth/admin/roles/$patient_id")
assert_eq "刪 patient 回 423" "423" "$code"

# 刪有綁 user 的 admin role → 422
admin_id=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/roles" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([r['id'] for r in d['roles'] if r['name']=='admin'][0])
")
code=$(status -b "$SUPER_COOKIE" -X DELETE "$BASE/auth/admin/roles/$admin_id")
assert_eq "刪有 user 的 role 回 422" "422" "$code"

# 刪 doctor_test（無 user、非 system）→ 200
code=$(status -b "$SUPER_COOKIE" -X DELETE "$BASE/auth/admin/roles/$doc_id")
assert_eq "刪 doctor_test 回 200" "200" "$code"

echo "── 9. 先建後綁（pre-create + bind）──"
# 建 user
resp=$(curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/admin/users" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"Test Bind User","role":"patient","clinic_id":"C001"}')
new_user_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['user_id'])")
bind_token=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['binding_token'])")
[[ -n "$new_user_id" ]] && assert_eq "建立 user 回傳 user_id" "yes" "yes" || assert_eq "建立 user 回傳 user_id" "yes" "no"
[[ ${#bind_token} -gt 20 ]] && assert_eq "binding_token 產生" "yes" "yes" || assert_eq "binding_token 產生" "yes" "no"

# 不合法 clinic_id
code=$(status -b "$SUPER_COOKIE" -X POST "$BASE/auth/admin/users" \
    -H "Content-Type: application/json" -d '{"display_name":"bad","clinic_id":"bad clinic!"}')
assert_eq "不合法 clinic_id 回 400" "400" "$code"

# 綁定連結過期 → 410
code=$(status -X POST "$BASE/auth/line-bind" \
    -H "Content-Type: application/json" \
    -d '{"access_token":"fake","binding_token":"ghost-token-xxx"}')
# LINE 驗證會先失敗 → 401；若 LINE 成功則 410。測 "非 200" 即可
[[ "$code" == "401" || "$code" == "410" ]] && assert_eq "不存在 token 回 401/410" "ok" "ok" \
    || assert_eq "不存在 token 回 401/410" "ok" "FAIL($code)"

# 模擬綁定（直接 SQL 寫）→ 重產 token 應 409
docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -c "
UPDATE users SET line_uuid = 'Utest_bind_$new_user_id' WHERE id = $new_user_id;" >/dev/null
code=$(status -b "$SUPER_COOKIE" -X POST "$BASE/auth/admin/users/$new_user_id/binding-token")
assert_eq "已綁 user 不可重產 token (409)" "409" "$code"

# Admin 改 clinic_id
code=$(status -b "$SUPER_COOKIE" -X PATCH "$BASE/auth/admin/users/$new_user_id" \
    -H "Content-Type: application/json" -d '{"clinic_id":"C999"}')
assert_eq "改 clinic_id 回 200" "200" "$code"
got=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/admin/users" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print([u['clinic_id'] for u in d['users'] if u['id']==$new_user_id][0])
")
assert_eq "clinic_id 實際變更" "C999" "$got"

# login_logs 應有 password 登入記錄
cnt=$(docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -tAc \
    "SELECT COUNT(*) FROM login_logs WHERE user_agent LIKE 'password%'")
[[ $cnt -gt 0 ]] && assert_eq "login_logs 有 password 登入記錄" "yes" "yes" \
    || assert_eq "login_logs 有 password 登入記錄" "yes" "no"

# 清理測試 user（避免影響下次跑）
docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -c "
DELETE FROM users WHERE id = $new_user_id;" >/dev/null

echo "── 10. logout 後 token 被撤銷 ──"
curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/logout" >/dev/null
code=$(status -b "$SUPER_COOKIE" "$BASE/auth/me")
assert_eq "登出後 /auth/me 應 401" "401" "$code"

echo
echo "── 結果 ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
[[ $FAIL -eq 0 ]]
