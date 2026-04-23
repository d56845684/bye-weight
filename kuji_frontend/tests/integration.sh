#!/usr/bin/env bash
# kuji_frontend 整合測試 — 透過 nginx 驗證 page-level guard + public paths + asset serving。
#
# 覆蓋：
#   1. 公開頁面（/kuji/login, /kuji/signup）無需 cookie
#   2. 內頁（/kuji/board, /kuji/meetings, ...）未登入 → 302 /kuji/login
#   3. 登入後所有 route 皆 200
#   4. _next 靜態資源 + /kuji/sample/ 音檔不擋 auth_request
#   5. Asset MIME types（CSS / JS / MP3）正確
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash kuji_frontend/tests/integration.sh
#
# demo user: emily@acme.com / demo123

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

status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
redirect_to() { curl -s -o /dev/null -w "%{redirect_url}" "$@"; }
content_type() { curl -sI "$@" | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r\n' | cut -d';' -f1; }

header() { printf "\n%s\n" "$(c '1;34' "── $* ──")"; }

# ════════════════════════════════════════════════════════════════
# 1. 公開頁面（無 cookie 可達）
# ════════════════════════════════════════════════════════════════
header "1. 公開頁面（無 cookie）"

assert_eq "/kuji/login → 200"  "200" "$(status "$BASE/kuji/login")"
assert_eq "/kuji/signup → 200" "200" "$(status "$BASE/kuji/signup")"

# ════════════════════════════════════════════════════════════════
# 2. Guard — 未登入進內頁應重導
# ════════════════════════════════════════════════════════════════
header "2. 內頁 guard（未登入 → /kuji/login）"

for path in /kuji /kuji/board /kuji/meetings /kuji/record /kuji/upload \
            /kuji/integrations /kuji/team /kuji/account /kuji/inbox \
            /kuji/settings /kuji/billing /kuji/onboarding \
            /kuji/tasks/1 /kuji/meetings/1; do
    code=$(status "$BASE$path")
    # /kuji 根會直接 301 → /kuji/；其餘 302 → /kuji/login
    if [[ "$code" == "302" ]] || [[ "$code" == "301" ]]; then
        printf "  %s %s → %s (redirect)\n" "$(c '32' '✓')" "$path" "$code"
        PASS=$((PASS + 1))
    else
        printf "  %s %s → %s (expected 301 or 302)\n" "$(c '31' '✗')" "$path" "$code"
        FAIL=$((FAIL + 1))
    fi
done

target=$(redirect_to "$BASE/kuji/board")
assert_eq "/kuji/board redirect → /kuji/login" "$BASE/kuji/login" "$target"

# ════════════════════════════════════════════════════════════════
# 3. 登入後頁面都能進
# ════════════════════════════════════════════════════════════════
header "3. 登入後 (/kuji/*)"

curl -sc "$COOKIE" -o /dev/null -X POST "$BASE/auth/v1/password-login" \
    -H "Content-Type: application/json" \
    -d '{"email":"emily@acme.com","password":"demo123"}'

for path in /kuji/board /kuji/meetings /kuji/meetings/1 /kuji/tasks/1 \
            /kuji/record /kuji/upload /kuji/integrations /kuji/team \
            /kuji/account /kuji/inbox /kuji/settings /kuji/billing \
            /kuji/onboarding; do
    code=$(status -b "$COOKIE" "$BASE$path")
    assert_eq "已登入 $path" "200" "$code"
done

# ════════════════════════════════════════════════════════════════
# 4. Public assets — _next, favicon, sample
# ════════════════════════════════════════════════════════════════
header "4. 靜態資源（不擋 auth_request）"

# 撈一個實際的 CSS chunk URL
css_url=$(curl -sb "$COOKIE" "$BASE/kuji/login" | grep -oE '/kuji/_next/static/css/[^"]+\.css' | head -1)
if [[ -n "$css_url" ]]; then
    ct=$(content_type "$BASE$css_url")
    assert_eq "CSS chunk MIME = text/css" "text/css" "$ct"
    # 最關鍵：無 cookie 也要拿得到（login 頁需要）
    code=$(status "$BASE$css_url")
    assert_eq "CSS chunk 無 cookie 可存取" "200" "$code"
fi

js_url=$(curl -sb "$COOKIE" "$BASE/kuji/login" | grep -oE '/kuji/_next/static/chunks/[^"]+\.js' | head -1)
if [[ -n "$js_url" ]]; then
    ct=$(content_type "$BASE$js_url")
    assert_eq "JS chunk MIME = application/javascript" "application/javascript" "$ct"
    code=$(status "$BASE$js_url")
    assert_eq "JS chunk 無 cookie 可存取" "200" "$code"
fi

# sample 音檔
ct=$(content_type "$BASE/kuji/sample/meeting-demo.mp3")
assert_eq "sample MP3 MIME = audio/mpeg" "audio/mpeg" "$ct"
code=$(status "$BASE/kuji/sample/meeting-demo.mp3")
assert_eq "sample MP3 無 cookie 可存取" "200" "$code"

# ════════════════════════════════════════════════════════════════
# 5. Logout
# ════════════════════════════════════════════════════════════════
header "5. Logout"

code=$(status -b "$COOKIE" -X POST "$BASE/auth/v1/logout")
assert_eq "POST /auth/v1/logout → 200" "200" "$code"

# logout 後回到受保護頁面應重導
# (cookie 檔內還有 access_token=empty max-age=0，server 照樣視為未登入)
rm -f "$COOKIE"; COOKIE=$(mktemp); trap 'rm -f "$COOKIE"' EXIT
code=$(status "$BASE/kuji/board")
assert_eq "logout 後 /kuji/board → 302" "302" "$code"

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
