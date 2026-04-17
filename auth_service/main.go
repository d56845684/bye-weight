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
	r.Post("/auth/refresh", h.Refresh)
	r.Post("/auth/logout", h.Logout)
	r.Get("/auth/health", h.Health)

	log.Println("auth service listening on :8001")
	log.Fatal(http.ListenAndServe(":8001", r))
}
