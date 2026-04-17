.PHONY: build run test clean migrate-up migrate-down migrate-create migrate-force

# ── 應用程式 ──────────────────────────────────────
build:
	go build -o auth_service .

run:
	go run .

test:
	go test ./... -v -cover

clean:
	rm -f auth_service

# ── Database Migration ────────────────────────────
# 需要安裝: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
DB_URL ?= postgres://postgres:dev@localhost:5432/auth_db?sslmode=disable
MIGRATIONS_DIR = migrations

migrate-up:
	migrate -path $(MIGRATIONS_DIR) -database "$(DB_URL)" up

migrate-down:
	migrate -path $(MIGRATIONS_DIR) -database "$(DB_URL)" down 1

migrate-down-all:
	migrate -path $(MIGRATIONS_DIR) -database "$(DB_URL)" down

migrate-version:
	migrate -path $(MIGRATIONS_DIR) -database "$(DB_URL)" version

migrate-force:
	@echo "Usage: make migrate-force VERSION=N"
	migrate -path $(MIGRATIONS_DIR) -database "$(DB_URL)" force $(VERSION)

migrate-create:
	@echo "Usage: make migrate-create NAME=add_something"
	migrate create -ext sql -dir $(MIGRATIONS_DIR) -seq $(NAME)
