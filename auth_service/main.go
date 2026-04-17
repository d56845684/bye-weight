package main

import (
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"auth_service/config"
	"auth_service/engine"
	"auth_service/handler"
	"auth_service/store"
)

func main() {
	cfg := config.Load()

	// 啟動前自動 migrate
	if err := RunMigrations(cfg.AuthDatabaseURL, "migrations"); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	db := store.NewDB(cfg.AuthDatabaseURL)
	rdb := store.NewRedis(cfg.RedisURL)
	eng := engine.New(db, rdb)
	h := handler.New(cfg, eng, rdb)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/auth/verify", h.Verify)
	r.Post("/auth/line-token", h.LineLogin)
	r.Post("/auth/google", h.GoogleLogin)
	r.Post("/auth/password-login", h.PasswordLogin)
	r.Post("/auth/line-bind", h.LineBind)
	r.Post("/auth/refresh", h.Refresh)
	r.Post("/auth/logout", h.Logout)
	r.Get("/auth/health", h.Health)
	r.Get("/auth/me", h.Me)

	// 管理後台 API（nginx 會先擋對應 permission）
	r.Get("/auth/admin/users", h.ListUsers)
	r.Post("/auth/admin/users", h.CreateUser)
	r.Patch("/auth/admin/users/{id}", h.UpdateUser)
	r.Post("/auth/admin/users/{id}/binding-token", h.RegenerateBindToken)
	r.Get("/auth/admin/roles", h.ListRoles)
	r.Post("/auth/admin/roles", h.CreateRole)
	r.Delete("/auth/admin/roles/{id}", h.DeleteRole)
	r.Get("/auth/admin/roles/{id}/permissions", h.GetRolePermissions)
	r.Put("/auth/admin/roles/{id}/permissions", h.SetRolePermissions)
	r.Get("/auth/admin/permissions", h.ListPermissions)

	// Dev-only：非 production 才掛上，handler 內也會再檢查一次
	if cfg.Env != "production" {
		r.Post("/auth/dev-login", h.DevLogin)
		log.Println("dev-login endpoint enabled at POST /auth/dev-login")
	}

	log.Println("auth service listening on :8001")
	log.Fatal(http.ListenAndServe(":8001", r))
}
