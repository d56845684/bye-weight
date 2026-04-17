.PHONY: run test migrate-up migrate-down migrate-head migrate-history migrate-create

# ── 應用程式 ──────────────────────────────────────
run:
	uvicorn main:app --reload --port 8000

test:
	pytest tests/ -v

# ── Database Migration (Alembic) ──────────────────
# APP_DATABASE_URL 需為同步 driver（去掉 +asyncpg）
# 例: postgresql://postgres:dev@localhost:5432/app_db

migrate-up:
	alembic upgrade head

migrate-down:
	alembic downgrade -1

migrate-head:
	alembic current

migrate-history:
	alembic history --verbose

migrate-create:
	@echo "Usage: make migrate-create MSG='add_something'"
	alembic revision --autogenerate -m "$(MSG)"
