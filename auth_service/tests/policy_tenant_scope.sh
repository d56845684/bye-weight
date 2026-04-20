#!/usr/bin/env bash
# Phase 2a：policies.tenant_id + handler tenant-scope guard 整合測試。
#
# 透過 super_admin 走 HTTP 驗：
#   - LIST / GET response 正確帶 tenant_id
#   - 自家 + 別家 policies 都能看
#   - PATCH 系統 policy / tenant-owned policy 都能改（super 無界線）
#
# clinic-admin 端 HTTP 測試暫時借「臨時 patch clinic-admin policy 給 admin:policy:*」
# 做，跑完還原：
#   - LIST 只看到 own-tenant + system (tenant_id=0)；別 tenant 的不見
#   - GET 別 tenant 的 → 404
#   - PATCH 系統 policy → 403
#   - PATCH own-tenant policy → 200
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash auth_service/tests/policy_tenant_scope.sh

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SUPER_COOKIE=$(mktemp)
ADMIN_COOKIE=$(mktemp)

# 硬刪測資：腳本創的兩個 tenant / user / 兩個 policies 在 EXIT 時一律清掉。
# restore_clinic_admin 會在下方實際定義後替換進 trap。
initial_cleanup() {
    # Redis revoke key（刪 user 前抓 id）
    local uids
    uids=$(docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -qAtc \
        "SELECT id FROM users WHERE line_uuid='pts-admin-a';" 2>/dev/null)
    for uid in $uids; do
        docker compose -f docker-compose.dev.yml exec -T redis redis-cli DEL "auth:user_revoke:$uid" >/dev/null 2>&1 || true
    done

    docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d auth_db -qAtc "
        DELETE FROM role_policies WHERE policy_id IN (SELECT id FROM policies WHERE name IN ('pts-a-policy','pts-b-policy'));
        DELETE FROM policies WHERE name IN ('pts-a-policy','pts-b-policy');
        DELETE FROM users WHERE line_uuid='pts-admin-a';
        DELETE FROM tenant_services WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('pts-tenant-a','pts-tenant-b'));
        DELETE FROM tenant_roles    WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('pts-tenant-a','pts-tenant-b'));
        DELETE FROM tenants WHERE slug IN ('pts-tenant-a','pts-tenant-b');
    " >/dev/null 2>&1 || true
    rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE"
}
trap initial_cleanup EXIT

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

psql_auth() {
    docker compose -f docker-compose.dev.yml exec -T postgres \
        psql -U postgres -d auth_db -qAtc "$1"
}

status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

dev_login() {
    local cookie="$1" body="$2"
    curl -s -c "$cookie" -X POST "$BASE/auth/v1/dev-login" \
        -H "Content-Type: application/json" -d "$body" >/dev/null
}

# ──────────────── setup ────────────────
echo "── seed: 兩個測試 tenant + clinic-admin user ──"
psql_auth "
INSERT INTO tenants (id, slug, name, active)
VALUES
  ((SELECT COALESCE(MAX(id), 0) + 1 FROM tenants WHERE id > 0), 'pts-tenant-a', 'PTS Tenant A', true)
ON CONFLICT (slug) DO UPDATE SET active=true;
INSERT INTO tenants (id, slug, name, active)
VALUES
  ((SELECT COALESCE(MAX(id), 0) + 1 FROM tenants WHERE id > 0), 'pts-tenant-b', 'PTS Tenant B', true)
ON CONFLICT (slug) DO UPDATE SET active=true;
" >/dev/null
TENANT_A=$(psql_auth "SELECT id FROM tenants WHERE slug='pts-tenant-a';")
TENANT_B=$(psql_auth "SELECT id FROM tenants WHERE slug='pts-tenant-b';")

psql_auth "
INSERT INTO tenant_services (tenant_id, service_id)
SELECT $TENANT_A, s.id FROM services s
ON CONFLICT DO NOTHING;
INSERT INTO tenant_services (tenant_id, service_id)
SELECT $TENANT_B, s.id FROM services s
ON CONFLICT DO NOTHING;
INSERT INTO tenant_roles (tenant_id, role_id)
SELECT $TENANT_A, r.id FROM roles r WHERE r.name IN ('admin','patient')
ON CONFLICT DO NOTHING;
INSERT INTO tenant_roles (tenant_id, role_id)
SELECT $TENANT_B, r.id FROM roles r WHERE r.name IN ('admin','patient')
ON CONFLICT DO NOTHING;
" >/dev/null

psql_auth "
INSERT INTO users (line_uuid, role_id, tenant_id, active, display_name)
VALUES ('pts-admin-a', (SELECT id FROM roles WHERE name='admin'), $TENANT_A, true, 'PTS Admin A')
ON CONFLICT (line_uuid) DO UPDATE SET active=true, tenant_id=$TENANT_A,
    role_id=(SELECT id FROM roles WHERE name='admin');
" >/dev/null

# 清 revoke key 避免 dev-login 給出的 token 被舊紀錄作廢
UID_A=$(psql_auth "SELECT id FROM users WHERE line_uuid='pts-admin-a';")
for uid in 1 "$UID_A"; do
    docker compose -f docker-compose.dev.yml exec -T redis redis-cli DEL "auth:user_revoke:$uid" >/dev/null
done

echo "── seed: 兩個 tenant-owned policies + 記下 system policy id ──"
# 先拿一個已知的 system policy id（tenant_id=0）做測試對象
SYS_POLICY_ID=$(psql_auth "SELECT id FROM policies WHERE name='patient-self-access' AND tenant_id=0;")

# 給 tenant A / B 各造一個 policy
psql_auth "
INSERT INTO policies (name, tenant_id, document)
VALUES ('pts-a-policy', $TENANT_A, '{\"statements\":[{\"effect\":\"allow\",\"actions\":[\"main:food_log:read\"],\"resources\":[\"main:tenant/$TENANT_A/*\"]}]}')
ON CONFLICT (name) DO UPDATE SET tenant_id=$TENANT_A;
INSERT INTO policies (name, tenant_id, document)
VALUES ('pts-b-policy', $TENANT_B, '{\"statements\":[{\"effect\":\"allow\",\"actions\":[\"main:visit:read\"],\"resources\":[\"main:tenant/$TENANT_B/*\"]}]}')
ON CONFLICT (name) DO UPDATE SET tenant_id=$TENANT_B;
" >/dev/null
POLICY_A=$(psql_auth "SELECT id FROM policies WHERE name='pts-a-policy';")
POLICY_B=$(psql_auth "SELECT id FROM policies WHERE name='pts-b-policy';")

# ──────────────── super_admin 流 ────────────────
echo "── super_admin 能看到所有 policies、tenant_id 帶出來 ──"
dev_login "$SUPER_COOKIE" '{}'
resp=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/v1/admin/policies")

# 每個預期存在的 policy，都要能在列表裡找到對應 tenant_id
count_a=$(echo "$resp" | python3 -c "
import sys,json
d = json.load(sys.stdin)
for p in d['policies']:
    if p['name'] == 'pts-a-policy' and p['tenant_id'] == $TENANT_A:
        print(1); break
else: print(0)
")
assert_eq "super LIST 看到 pts-a-policy 且 tenant_id=$TENANT_A" "1" "$count_a"

count_b=$(echo "$resp" | python3 -c "
import sys,json
d = json.load(sys.stdin)
for p in d['policies']:
    if p['name'] == 'pts-b-policy' and p['tenant_id'] == $TENANT_B:
        print(1); break
else: print(0)
")
assert_eq "super LIST 看到 pts-b-policy 且 tenant_id=$TENANT_B" "1" "$count_b"

count_sys=$(echo "$resp" | python3 -c "
import sys,json
d = json.load(sys.stdin)
for p in d['policies']:
    if p['name'] == 'patient-self-access' and p['tenant_id'] == 0:
        print(1); break
else: print(0)
")
assert_eq "super LIST 看到 patient-self-access (系統 tenant_id=0)" "1" "$count_sys"

echo "── super GET /policies/{id} 帶 tenant_id ──"
resp=$(curl -s -b "$SUPER_COOKIE" "$BASE/auth/v1/admin/policies/$POLICY_A")
tid=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant_id'])")
assert_eq "super GET pts-a-policy tenant_id=$TENANT_A" "$TENANT_A" "$tid"

# ──────────────── 臨時幫 clinic-admin 開 admin:policy:* 以便測 guard ────────────────
echo "── 臨時讓 clinic-admin 有 admin:policy:* （跑完會還原）──"
# 保存原始 document
ORIG_ADMIN_POLICY=$(psql_auth "SELECT document FROM policies WHERE name='clinic-admin';")

psql_auth "
UPDATE policies
SET document = jsonb_set(document, '{statements}',
    (document->'statements') || '[{\"effect\":\"allow\",\"actions\":[\"admin:policy:read\",\"admin:policy:write\"],\"resources\":[\"admin:policy\",\"admin:policy/*\"]}]'::jsonb
)
WHERE name='clinic-admin';
" >/dev/null
# 讓 engine 重讀
curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/invalidate" >/dev/null

restore_clinic_admin() {
    psql_auth "UPDATE policies SET document = '$ORIG_ADMIN_POLICY' WHERE name='clinic-admin';" >/dev/null
    curl -s -b "$SUPER_COOKIE" -X POST "$BASE/auth/v1/admin/invalidate" >/dev/null
}
# 包住原本的 cleanup：還原 clinic-admin → 硬刪測資 → rm cookies
trap 'restore_clinic_admin; initial_cleanup' EXIT

# ──────────────── clinic-admin in tenant A 流 ────────────────
echo "── clinic-admin (tenant A) 登入 ──"
dev_login "$ADMIN_COOKIE" '{"line_uuid":"pts-admin-a"}'
role=$(curl -s -b "$ADMIN_COOKIE" "$BASE/auth/v1/me" | python3 -c "import sys,json; print(json.load(sys.stdin)['role'])")
assert_eq "pts-admin-a role" "admin" "$role"

echo "── LIST：只看到自家 tenant A + 系統 (tenant_id=0)；看不到 B ──"
resp=$(curl -s -b "$ADMIN_COOKIE" "$BASE/auth/v1/admin/policies")
has_a=$(echo "$resp" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(1 if any(p['name']=='pts-a-policy' for p in d['policies']) else 0)
")
has_b=$(echo "$resp" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(1 if any(p['name']=='pts-b-policy' for p in d['policies']) else 0)
")
has_sys=$(echo "$resp" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(1 if any(p['name']=='patient-self-access' for p in d['policies']) else 0)
")
assert_eq "看到 pts-a-policy"        "1" "$has_a"
assert_eq "看不到 pts-b-policy"      "0" "$has_b"
assert_eq "看到系統 patient-self-access" "1" "$has_sys"

echo "── GET：自家 → 200；別家 → 404（不洩露存在）──"
code=$(status -b "$ADMIN_COOKIE" "$BASE/auth/v1/admin/policies/$POLICY_A")
assert_eq "GET 自家 tenant A policy → 200" "200" "$code"
code=$(status -b "$ADMIN_COOKIE" "$BASE/auth/v1/admin/policies/$POLICY_B")
assert_eq "GET 別 tenant B policy → 404" "404" "$code"
code=$(status -b "$ADMIN_COOKIE" "$BASE/auth/v1/admin/policies/$SYS_POLICY_ID")
assert_eq "GET 系統 policy → 200（可讀不可改）" "200" "$code"

echo "── PATCH：系統 policy → 403；別家 → 403；自家 → 200 ──"
safe_doc='{"document":{"statements":[{"effect":"allow","actions":["main:food_log:read"],"resources":["*"]}]}}'

code=$(status -b "$ADMIN_COOKIE" -X PATCH "$BASE/auth/v1/admin/policies/$SYS_POLICY_ID" \
    -H "Content-Type: application/json" -d "$safe_doc")
assert_eq "PATCH 系統 policy → 403" "403" "$code"

code=$(status -b "$ADMIN_COOKIE" -X PATCH "$BASE/auth/v1/admin/policies/$POLICY_B" \
    -H "Content-Type: application/json" -d "$safe_doc")
assert_eq "PATCH 別 tenant policy → 403" "403" "$code"

code=$(status -b "$ADMIN_COOKIE" -X PATCH "$BASE/auth/v1/admin/policies/$POLICY_A" \
    -H "Content-Type: application/json" -d "$safe_doc")
assert_eq "PATCH 自家 policy → 200" "200" "$code"

echo
echo "── Summary ──"
echo "  PASS=$PASS  FAIL=$FAIL"
[[ "$FAIL" == "0" ]] || exit 1
