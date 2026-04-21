#!/usr/bin/env bash
# /auth/v1/me/permissions 端點 + Phase 1 permission-based UI gating 的整合測試。
#
# 驗證：
#   1. 無 cookie → 401
#   2. super_admin → actions=["*"]
#   3. clinic-admin (role=admin) → 含 admin:user:*、admin:tenant:read，但沒 admin:tenant:write
#   4. patient → 只有 main:* 權限，沒任何 admin:*
#   5. tenant 停用 → 401（與 verifySession 行為一致）
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash auth_service/tests/permissions.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER_COOKIE=$(mktemp)
ADMIN_COOKIE=$(mktemp)
PATIENT_COOKIE=$(mktemp)

# 硬刪 + cookie 清除：trap 保證失敗 / ctrl-c 都會跑
cleanup() {
    # 透過 auth_identities join 拿 user_id（line_uuid 已 refactor 到 identities）
    local uids
    uids=$(docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -qAtc \
        "SELECT user_id FROM auth_identities WHERE provider='line' AND subject IN ('perm-test-admin','perm-test-patient');" 2>/dev/null)
    for uid in $uids; do
        docker compose -f docker-compose.dev.yml exec -T redis redis-cli DEL "auth:user_revoke:$uid" >/dev/null 2>&1 || true
    done

    # 硬刪測資：先刪 auth_identities，再刪 users、tenant_services / tenant_roles / tenants
    docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -qAtc "
        DELETE FROM users WHERE id IN (
            SELECT user_id FROM auth_identities
            WHERE provider='line' AND subject IN ('perm-test-admin','perm-test-patient')
        );
        DELETE FROM tenant_services WHERE tenant_id = (SELECT id FROM tenants WHERE slug='perm-test-tenant');
        DELETE FROM tenant_roles    WHERE tenant_id = (SELECT id FROM tenants WHERE slug='perm-test-tenant');
        DELETE FROM tenants WHERE slug='perm-test-tenant';
    " >/dev/null 2>&1 || true

    rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE" "$PATIENT_COOKIE"
}
trap cleanup EXIT

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

assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        echo "  ✓ $label"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $label — \"$needle\" not in: $haystack"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        echo "  ✓ $label"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $label — \"$needle\" unexpectedly in: $haystack"
        FAIL=$((FAIL + 1))
    fi
}

psql_auth() {
    docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -qAtc "$1"
}

dev_login() {
    local cookie="$1" body="$2"
    curl -s -c "$cookie" -X POST "$BASE/auth/v1/dev-login" \
        -H "Content-Type: application/json" -d "$body" >/dev/null
}

status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "── seed 三種角色的測試 user ──"
# 確保 dev-admin 存在（migration 000003 有 seed，加保險）
# line_uuid 已搬到 auth_identities；查詢/保險透過 identity
psql_auth "
DO \$\$
DECLARE dev_uid INT;
BEGIN
  SELECT user_id INTO dev_uid FROM auth_identities
  WHERE provider='line' AND subject='dev-admin' AND deleted_at IS NULL;
  IF dev_uid IS NULL THEN
    INSERT INTO users (role_id, tenant_id, active, display_name)
    VALUES ((SELECT id FROM roles WHERE name='super_admin'), 0, true, 'Dev Super Admin')
    RETURNING id INTO dev_uid;
    INSERT INTO auth_identities (user_id, provider, subject) VALUES (dev_uid, 'line', 'dev-admin');
  ELSE
    UPDATE users SET active=true WHERE id=dev_uid;
  END IF;
END\$\$;
" >/dev/null

# 確保 Phase 1 測試 tenant 存在（slug=perm-test-tenant），並是 active
# tenants.id 沒 serial default —— 用 MAX(id)+1 挑（和 admin_tenants.go CreateTenant 一致）
psql_auth "
INSERT INTO tenants (id, slug, name, active)
VALUES (
  (SELECT COALESCE(MAX(id), 0) + 1 FROM tenants WHERE id > 0),
  'perm-test-tenant', 'Perm Test', true
)
ON CONFLICT (slug) DO UPDATE SET active=true;
" >/dev/null
TENANT_ID=$(psql_auth "SELECT id FROM tenants WHERE slug='perm-test-tenant';")

# tenant 要訂閱 main + admin service 並允許 admin/patient role；保險全帶
psql_auth "
INSERT INTO tenant_services (tenant_id, service_id)
SELECT $TENANT_ID, s.id FROM services s
ON CONFLICT DO NOTHING;
INSERT INTO tenant_roles (tenant_id, role_id)
SELECT $TENANT_ID, r.id FROM roles r WHERE r.name IN ('admin','patient')
ON CONFLICT DO NOTHING;
" >/dev/null

# seed 一個 clinic-admin 與一個 patient。identity 在 auth_identities；
# user row 本身用 DO block upsert，重跑測試不會積累殘留。
seed_user() {
    local line_subject="$1" role="$2" display="$3"
    psql_auth "
DO \$\$
DECLARE uid INT;
BEGIN
  SELECT user_id INTO uid FROM auth_identities
  WHERE provider='line' AND subject='$line_subject' AND deleted_at IS NULL;
  IF uid IS NULL THEN
    INSERT INTO users (role_id, tenant_id, active, display_name)
    VALUES ((SELECT id FROM roles WHERE name='$role'), $TENANT_ID, true, '$display')
    RETURNING id INTO uid;
    INSERT INTO auth_identities (user_id, provider, subject) VALUES (uid, 'line', '$line_subject');
  ELSE
    UPDATE users
    SET active=true, tenant_id=$TENANT_ID, role_id=(SELECT id FROM roles WHERE name='$role')
    WHERE id=uid;
  END IF;
END\$\$;
" >/dev/null
}
seed_user "perm-test-admin"   "admin"   "Perm Admin"
seed_user "perm-test-patient" "patient" "Perm Patient"

# 清掉先前測試殘留的 user_revoke（避免 dev-login 發的 token 立即失效）
for uuid in dev-admin perm-test-admin perm-test-patient; do
    uid=$(psql_auth "SELECT user_id FROM auth_identities WHERE provider='line' AND subject='$uuid' AND deleted_at IS NULL;")
    docker compose -f docker-compose.dev.yml exec -T redis redis-cli DEL "auth:user_revoke:$uid" >/dev/null
done

echo "── 1. 無 cookie → 401 ──"
code=$(status "$BASE/auth/v1/me/permissions")
assert_eq "/me/permissions 無 cookie 回 401" "401" "$code"

echo "── 2. super_admin → actions=[\"*\"] ──"
dev_login "$SUPER_COOKIE" '{}'
resp=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/v1/me/permissions")
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
actions=$(echo "$resp" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['actions']))")
assert_eq "super_admin role" "super_admin" "$role"
assert_eq "super_admin actions=[\"*\"]" '["*"]' "$actions"

echo "── 3. clinic-admin → 有 admin:user:*、admin:tenant:read；無 admin:tenant:write ──"
dev_login "$ADMIN_COOKIE" '{"line_uuid":"perm-test-admin"}'
resp=$(curl -s -b "$ADMIN_COOKIE" "$BASE/auth/v1/me/permissions")
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
actions=$(echo "$resp" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['actions']))")
assert_eq "clinic-admin role=admin" "admin" "$role"
assert_contains "含 admin:user:*"    '"admin:user:*"'    "$actions"
assert_contains "含 admin:tenant:read" '"admin:tenant:read"' "$actions"
assert_contains "含 main:patient:*"  '"main:patient:*"'  "$actions"
assert_not_contains "不含 admin:tenant:write" '"admin:tenant:write"' "$actions"
assert_not_contains "不含 admin:policy:read"  '"admin:policy:read"'  "$actions"
assert_not_contains "不含萬用 *"     '"*"'               "$actions"

echo "── 4. patient → 只有 main:*；沒任何 admin:* ──"
dev_login "$PATIENT_COOKIE" '{"line_uuid":"perm-test-patient"}'
resp=$(curl -s -b "$PATIENT_COOKIE" "$BASE/auth/v1/me/permissions")
role=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
actions=$(echo "$resp" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['actions']))")
assert_eq "patient role" "patient" "$role"
assert_contains "patient 含 main:food_log:*" '"main:food_log:*"' "$actions"
assert_contains "patient 含 main:patient:read" '"main:patient:read"' "$actions"
assert_not_contains "patient 無 admin:*"      '"admin:' "$actions"

echo "── 5. tenant 停用 → /me/permissions 回 401 tenant disabled ──"
psql_auth "UPDATE tenants SET active=false WHERE id=$TENANT_ID;" >/dev/null
code=$(status -b "$ADMIN_COOKIE" "$BASE/auth/v1/me/permissions")
assert_eq "tenant 停用時 clinic-admin 拿不到 permissions" "401" "$code"
code=$(status -b "$PATIENT_COOKIE" "$BASE/auth/v1/me/permissions")
assert_eq "tenant 停用時 patient 拿不到 permissions" "401" "$code"
code=$(status -b "$SUPER_COOKIE" "$BASE/auth/v1/me/permissions")
assert_eq "tenant 停用不影響 super_admin (tenant_id=0)" "200" "$code"

echo "── 6. 還原 tenant、清 revoke → 再次驗證能拿到 ──"
psql_auth "UPDATE tenants SET active=true WHERE id=$TENANT_ID;" >/dev/null
code=$(status -b "$ADMIN_COOKIE" "$BASE/auth/v1/me/permissions")
assert_eq "tenant 還原後 clinic-admin 恢復" "200" "$code"

echo
echo "── Summary ──"
echo "  PASS=$PASS  FAIL=$FAIL"
[[ "$FAIL" == "0" ]] || exit 1
