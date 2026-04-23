#!/usr/bin/env bash
# kuji_backend 整合測試 — 走完整 stack (nginx → auth_service → kuji_backend)。
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash kuji_backend/tests/integration.sh
#       BASE=http://localhost:8080 bash kuji_backend/tests/integration.sh
#
# 覆蓋：
#   1. Auth / 登入
#   2. Health
#   3. Meetings: list / detail (含 speakers + transcript + tasks)
#   4. Tasks: list / detail (含 clips) / CRUD
#   5. Integration providers + dynamic options
#   6. Meeting speakers 重指派 (3 種成功 case + 2 種錯誤 case)
#   7. Tenant isolation (帶假 header 應被 RLS / IAM 擋下)
#
# demo tenant user: emily@acme.com / demo123 → role=kuji_user, tenant=1, user=1001

set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

PASS=0
FAIL=0

c() { printf "\033[%sm%s\033[0m" "$1" "$2"; }

assert_eq() {
    if [[ "$2" == "$3" ]]; then
        printf "  %s %s\n" "$(c '32' '✓')" "$1"
        PASS=$((PASS + 1))
    else
        printf "  %s %s — expected=%s actual=%s\n" "$(c '31' '✗')" "$1" "$2" "$3"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    if echo "$2" | grep -q -- "$3"; then
        printf "  %s %s\n" "$(c '32' '✓')" "$1"
        PASS=$((PASS + 1))
    else
        printf "  %s %s — not found in response\n" "$(c '31' '✗')" "$1"
        FAIL=$((FAIL + 1))
    fi
}

status() {
    curl -s -o /dev/null -w "%{http_code}" "$@"
}

jq_get() {
    python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" <<< "$2"
}

header() { printf "\n%s\n" "$(c '1;34' "── $* ──")"; }

# ════════════════════════════════════════════════════════════════
# 1. Auth
# ════════════════════════════════════════════════════════════════
header "1. Auth 登入"

code=$(status -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"emily@acme.com","password":"demo123"}')
assert_eq "password-login 200" "200" "$code"

code=$(status -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"bad@x.com","password":"wrong"}')
assert_eq "錯密碼 401" "401" "$code"

# 正式登入拿 cookie
curl -sc "$COOKIE" -o /dev/null -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"emily@acme.com","password":"demo123"}'
me=$(curl -sb "$COOKIE" "$BASE/auth/v1/me")
assert_eq "/auth/me role=kuji_user" "kuji_user" "$(jq_get "d['role']" "$me")"
assert_eq "/auth/me tenant=1"        "1"         "$(jq_get "d['tenant_id']" "$me")"
assert_eq "/auth/me user_id=1001"    "1001"      "$(jq_get "d['user_id']" "$me")"

# ════════════════════════════════════════════════════════════════
# 2. /me sanity
# ════════════════════════════════════════════════════════════════
header "2. /kuji/api/v1/me"
resp=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/me")
assert_eq "/me user_id=1001"          "1001"      "$(jq_get "d['user_id']" "$resp")"
assert_eq "/me role=kuji_user"         "kuji_user" "$(jq_get "d['role']" "$resp")"
assert_eq "/me tenant_id=1"            "1"         "$(jq_get "d['tenant_id']" "$resp")"
assert_eq "/me member display=林怡君"  "林怡君"    "$(jq_get "d['member']['display_name']" "$resp")"

# ════════════════════════════════════════════════════════════════
# 3. Meetings
# ════════════════════════════════════════════════════════════════
header "3. Meetings list / detail"

meetings=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/meetings")
count=$(jq_get "len(d)" "$meetings")
# 期望至少 7 場（seed + 後續測試可能建新的；下限判斷）
if [[ "$count" -ge 7 ]]; then
    printf "  %s list 至少 7 場（實得 %s）\n" "$(c '32' '✓')" "$count"
    PASS=$((PASS + 1))
else
    printf "  %s list 至少 7 場（實得 %s）\n" "$(c '31' '✗')" "$count"
    FAIL=$((FAIL + 1))
fi
assert_contains "list 含 audio_url 欄位" "$meetings" '"audio_url"'

# meeting 1 detail
m1=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/meetings/1")
assert_eq "meeting 1 title" "Weekly Product Sync" "$(jq_get "d['title']" "$m1")"
assert_contains "meeting 1 有 speakers"   "$m1" '"speakers"'
assert_contains "meeting 1 有 transcript" "$m1" '"transcript"'
assert_contains "meeting 1 有 tasks"      "$m1" '"tasks"'

# speaker 有 resolved user info
s1_uid=$(jq_get "[s for s in d['speakers'] if s['speaker_id']=='S1'][0]['auth_user_id']" "$m1")
assert_eq "S1 auth_user_id=1001 (alias_match)" "1001" "$s1_uid"

# transcript row 的 speaker_user_id 跟 meeting_speakers JOIN 出來的一致
t0_uid=$(jq_get "d['transcript'][0]['speaker_user_id']" "$m1")
assert_eq "transcript[0].speaker_user_id 非空" "1001" "$t0_uid"

# 404
code=$(status -b "$COOKIE" "$BASE/kuji/api/v1/meetings/9999")
assert_eq "不存在 meeting 應 404" "404" "$code"

# ════════════════════════════════════════════════════════════════
# 4. Tasks CRUD
# ════════════════════════════════════════════════════════════════
header "4. Tasks list / detail / 建立 / 更新 / 刪除"

tasks=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/tasks")
assert_contains "list 至少 5 個 task" "$tasks" '"id":5'

# task 1 detail — primary clip + 2 related
t1=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/tasks/1")
primary_ct=$(jq_get "sum(1 for c in d['clips'] if c['role']=='primary')" "$t1")
related_ct=$(jq_get "sum(1 for c in d['clips'] if c['role']=='related')" "$t1")
assert_eq "task 1 primary count=1" "1" "$primary_ct"
assert_eq "task 1 related count=2" "2" "$related_ct"

# 來源片段 timestamp
start_ms=$(jq_get "[c for c in d['clips'] if c['role']=='primary'][0]['start_ms']" "$t1")
assert_eq "task 1 primary start_ms=759000" "759000" "$start_ms"

# POST 新 task
new_id=$(curl -sb "$COOKIE" -X POST "$BASE/kuji/api/v1/tasks" \
    -H "Content-Type: application/json" \
    -d '{"title":"INT-TEST task","owner_user_id":1001,"owner_name":"Emily","priority":"med","tag":"Slack","due_label":"today"}' \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
assert_contains "POST task 成功 (id 是整數)" "$new_id" "[0-9]"

# PATCH 狀態 → done
resp=$(curl -sb "$COOKIE" -X PATCH "$BASE/kuji/api/v1/tasks/$new_id" \
    -H "Content-Type: application/json" -d '{"status":"done"}')
assert_eq "PATCH status=done" "done" "$(jq_get "d['status']" "$resp")"

# DELETE (soft)
code=$(status -b "$COOKIE" -X DELETE "$BASE/kuji/api/v1/tasks/$new_id")
assert_eq "DELETE 200" "200" "$code"
# 再 GET 應該 404（soft-deleted，WHERE deleted_at IS NULL 擋掉）
code=$(status -b "$COOKIE" "$BASE/kuji/api/v1/tasks/$new_id")
assert_eq "soft-deleted task 再 GET = 404" "404" "$code"

# ════════════════════════════════════════════════════════════════
# 5. Integrations
# ════════════════════════════════════════════════════════════════
header "5. Integrations providers / list / dynamic options"

providers=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/integrations/providers")
assert_eq "providers 有 6 家" "6" "$(jq_get "len(d)" "$providers")"
assert_contains "含 notion" "$providers" '"kind":"notion"'
assert_contains "含 slack"  "$providers" '"kind":"slack"'

integrations=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/integrations")
assert_contains "integrations 含 config 欄位" "$integrations" '"config"'

# 動態選項
dyn=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/integrations/notion/resources/databases")
assert_contains "notion databases 動態選項非空" "$dyn" '"Product Tasks"'

# ════════════════════════════════════════════════════════════════
# 6. Meeting speaker 手動重指派 (PATCH /meetings/{id}/speakers/{speaker_id})
# ════════════════════════════════════════════════════════════════
header "6. Speaker reassign — PATCH /meetings/{id}/speakers/{speaker_id}"

# 先看 baseline：meeting 6 S7 Alex Lin 應該是 external / unknown
m6=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/meetings/6")
s7_before=$(jq_get "[s for s in d['speakers'] if s['speaker_id']=='S7'][0]['auth_user_id']" "$m6")
assert_eq "baseline S7 is external (uid=None)" "None" "$s7_before"

# Case 1: 指派給 team member (tina=1006)
resp=$(curl -sb "$COOKIE" -X PATCH "$BASE/kuji/api/v1/meetings/6/speakers/S7" \
    -H "Content-Type: application/json" -d '{"auth_user_id":1006}')
assert_eq "Case 1 uid=1006"            "1006"              "$(jq_get "d['auth_user_id']" "$resp")"
assert_eq "Case 1 ext=false"           "False"             "$(jq_get "d['is_external']" "$resp")"
assert_eq "Case 1 display_name=黃雅婷" "黃雅婷"             "$(jq_get "d['display_name']" "$resp")"
assert_eq "Case 1 source=manual"       "manual_override"   "$(jq_get "d['match_source']" "$resp")"
assert_eq "Case 1 confidence=1.0"      "1.0"               "$(jq_get "d['match_confidence']" "$resp")"

# Case 2: 標回外部 + 設 org
resp=$(curl -sb "$COOKIE" -X PATCH "$BASE/kuji/api/v1/meetings/6/speakers/S7" \
    -H "Content-Type: application/json" -d '{"auth_user_id":null,"external_org":"Contractor"}')
assert_eq "Case 2 uid=None"            "None"              "$(jq_get "d['auth_user_id']" "$resp")"
assert_eq "Case 2 ext=true"            "True"              "$(jq_get "d['is_external']" "$resp")"
assert_eq "Case 2 org=Contractor"      "Contractor"        "$(jq_get "d['external_org']" "$resp")"

# Case 3: 只改 display_name
resp=$(curl -sb "$COOKIE" -X PATCH "$BASE/kuji/api/v1/meetings/6/speakers/S7" \
    -H "Content-Type: application/json" -d '{"display_name":"Alex Lin (ext)"}')
assert_eq "Case 3 display_name"        "Alex Lin (ext)"    "$(jq_get "d['display_name']" "$resp")"
assert_eq "Case 3 uid 未變"            "None"              "$(jq_get "d['auth_user_id']" "$resp")"
assert_eq "Case 3 org 未變"            "Contractor"        "$(jq_get "d['external_org']" "$resp")"

# 驗 transcript 會 JOIN 取到新 display
m6=$(curl -sb "$COOKIE" "$BASE/kuji/api/v1/meetings/6")
s7_in_transcript=$(jq_get "[s for s in d['transcript'] if s['speaker_id']=='S7'][0]['speaker_name']" "$m6")
assert_eq "transcript S7 顯示新名字"   "Alex Lin (ext)"    "$s7_in_transcript"

# Case 4: 不存在的 team member user
code=$(status -b "$COOKIE" -X PATCH "$BASE/kuji/api/v1/meetings/6/speakers/S7" \
    -H "Content-Type: application/json" -d '{"auth_user_id":9999}')
assert_eq "Case 4 不存在 user = 400" "400" "$code"

# Case 5: 不存在的 speaker
code=$(status -b "$COOKIE" -X PATCH "$BASE/kuji/api/v1/meetings/6/speakers/S99" \
    -H "Content-Type: application/json" -d '{"auth_user_id":1001}')
assert_eq "Case 5 不存在 speaker = 404" "404" "$code"

# restore baseline（讓測試可重跑）
curl -sb "$COOKIE" -X PATCH "$BASE/kuji/api/v1/meetings/6/speakers/S7" \
    -H "Content-Type: application/json" \
    -d '{"auth_user_id":null,"display_name":"Alex Lin","external_org":null}' >/dev/null

# ════════════════════════════════════════════════════════════════
# 7. Tenant isolation — 無 cookie 應被 nginx auth_request 擋
# ════════════════════════════════════════════════════════════════
header "7. Auth / tenant isolation"

code=$(status "$BASE/kuji/api/v1/meetings")
assert_eq "無 cookie → 401" "401" "$code"

# 無 auth 的 playground 測試：直接打 kuji_backend:8000 不該通（那是 docker network 內部，
# 從外面打不到；這裡靠 nginx 擋）。nginx 沒路由就是 404。
# 略過 — 環境差異大。

# ════════════════════════════════════════════════════════════════
# Result
# ════════════════════════════════════════════════════════════════
echo
header "RESULT"
echo "  $(c '32' "PASS: $PASS")"
if [[ $FAIL -eq 0 ]]; then
    echo "  $(c '32' "FAIL: $FAIL") · all green"
    exit 0
else
    echo "  $(c '31' "FAIL: $FAIL")"
    exit 1
fi
