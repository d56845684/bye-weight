#!/usr/bin/env bash
# Kuji 端對端回歸測試 — 後端 integration + pytest + 前端 integration 都跑。
#
# 前置：docker compose -f docker-compose.dev.yml --profile full up -d
# 用法：bash scripts/test-kuji.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "════════════════════════════════════════"
echo "  1/3  kuji_backend integration"
echo "════════════════════════════════════════"
bash "$ROOT/kuji_backend/tests/integration.sh"
echo

echo "════════════════════════════════════════"
echo "  2/3  kuji_backend pytest"
echo "════════════════════════════════════════"
docker run --rm \
    -v "$ROOT/kuji_backend":/app -w /app \
    python:3.11-slim \
    sh -c "pip install -q -r requirements.txt && python -m pytest tests/ -v"
echo

echo "════════════════════════════════════════"
echo "  3/3  kuji_frontend integration"
echo "════════════════════════════════════════"
bash "$ROOT/kuji_frontend/tests/integration.sh"

echo
echo "✅ All Kuji tests passed."
