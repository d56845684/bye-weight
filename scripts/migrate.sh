#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# 統一 Migration 腳本
# 用法:
#   ./scripts/migrate.sh up        # 兩個服務都 migrate up
#   ./scripts/migrate.sh down      # 兩個服務都 rollback 1 步
#   ./scripts/migrate.sh status    # 顯示各服務目前版本
#   ./scripts/migrate.sh reset     # ⚠️ 全部 rollback（dev only）
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# 預設 DB URLs（本機開發用）
AUTH_DB_URL="${AUTH_DATABASE_URL:-postgres://postgres:dev@localhost:5433/auth_db?sslmode=disable}"
APP_DB_URL="${APP_DATABASE_URL:-postgresql://postgres:dev@localhost:5433/app_db}"

CMD="${1:-status}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Migration: $CMD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case "$CMD" in
  up)
    echo ""
    echo "▶ auth_service (golang-migrate)"
    cd "$ROOT_DIR/auth_service"
    migrate -path migrations -database "$AUTH_DB_URL" up
    echo ""
    echo "▶ main_service (alembic)"
    cd "$ROOT_DIR/main_service"
    APP_DATABASE_URL="$APP_DB_URL" alembic upgrade head
    ;;

  down)
    echo ""
    echo "▶ main_service (alembic) — rollback 1"
    cd "$ROOT_DIR/main_service"
    APP_DATABASE_URL="$APP_DB_URL" alembic downgrade -1
    echo ""
    echo "▶ auth_service (golang-migrate) — rollback 1"
    cd "$ROOT_DIR/auth_service"
    migrate -path migrations -database "$AUTH_DB_URL" down 1
    ;;

  status)
    echo ""
    echo "▶ auth_service (golang-migrate)"
    cd "$ROOT_DIR/auth_service"
    migrate -path migrations -database "$AUTH_DB_URL" version 2>&1 || echo "  (no migrations applied)"
    echo ""
    echo "▶ main_service (alembic)"
    cd "$ROOT_DIR/main_service"
    APP_DATABASE_URL="$APP_DB_URL" alembic current 2>&1 || echo "  (no migrations applied)"
    ;;

  reset)
    echo ""
    echo "⚠️  這會刪除所有資料！只用於開發環境。"
    read -p "確定要 reset? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "▶ main_service — downgrade all"
      cd "$ROOT_DIR/main_service"
      APP_DATABASE_URL="$APP_DB_URL" alembic downgrade base
      echo "▶ auth_service — downgrade all"
      cd "$ROOT_DIR/auth_service"
      migrate -path migrations -database "$AUTH_DB_URL" down -all
      echo ""
      echo "▶ re-applying all migrations..."
      "$0" up
    fi
    ;;

  *)
    echo "用法: $0 {up|down|status|reset}"
    exit 1
    ;;
esac

echo ""
echo "✓ done"
