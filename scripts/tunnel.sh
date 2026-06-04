#!/usr/bin/env bash
# 用 Cloudflare quick tunnel 把本機服務暴露到公網（開發用，免帳號）。
# 預設指向 nginx 的 8080；測 LINE webhook 時把印出的網址填到
# LINE Developers Console → Messaging API → Webhook URL：
#   https://xxxx.trycloudflare.com/api/v1/line/webhook
#
# 用法：
#   ./scripts/tunnel.sh          # http://localhost:8080
#   ./scripts/tunnel.sh 8000     # 指定其他 port
set -euo pipefail

PORT="${1:-8080}"
URL="http://localhost:${PORT}"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "找不到 cloudflared，請先安裝：brew install cloudflared" >&2
    exit 1
fi

# 確認本機服務有起來，避免開了 tunnel 卻打到空氣
if ! curl -sf -o /dev/null --max-time 3 "${URL}/api/v1/health" \
   && ! curl -s -o /dev/null --max-time 3 "${URL}"; then
    echo "警告：${URL} 沒有回應，記得先把服務跑起來：" >&2
    echo "  docker compose -f docker-compose.dev.yml --profile full up -d" >&2
fi

LOG="$(mktemp -t cloudflared-tunnel)"
cleanup() {
    [[ -n "${TUNNEL_PID:-}" ]] && kill "${TUNNEL_PID}" 2>/dev/null || true
    rm -f "${LOG}"
}
trap cleanup EXIT INT TERM

echo "啟動 Cloudflare quick tunnel → ${URL} ..."
cloudflared tunnel --url "${URL}" --no-autoupdate >"${LOG}" 2>&1 &
TUNNEL_PID=$!

# 等 cloudflared 印出隨機分配的 trycloudflare 網址
PUBLIC_URL=""
for _ in $(seq 1 30); do
    PUBLIC_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG}" | head -1 || true)"
    [[ -n "${PUBLIC_URL}" ]] && break
    if ! kill -0 "${TUNNEL_PID}" 2>/dev/null; then
        echo "cloudflared 啟動失敗：" >&2
        cat "${LOG}" >&2
        exit 1
    fi
    sleep 1
done

if [[ -z "${PUBLIC_URL}" ]]; then
    echo "等不到 tunnel 網址，cloudflared log：" >&2
    cat "${LOG}" >&2
    exit 1
fi

echo
echo "════════════════════════════════════════════════════"
echo "  公開網址：    ${PUBLIC_URL}"
echo "  LINE Webhook：${PUBLIC_URL}/api/v1/line/webhook"
echo "════════════════════════════════════════════════════"
echo
echo "按 Ctrl+C 結束 tunnel。"

wait "${TUNNEL_PID}"
