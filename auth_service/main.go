package main

import (
	"log"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"auth_service/config"
	"auth_service/engine"
	"auth_service/handler"
	"auth_service/store"
)

func main() {
	cfg := config.Load()

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

	// chi-only：Nginx auth_request 呼叫的內部端點（不進 OpenAPI UI 比較乾淨）
	r.Get("/auth/verify", h.Verify)
	r.Get("/auth/verify-page", h.VerifyPage)

	// huma：對外所有 JSON API 都經此註冊，自動產 OpenAPI spec 並交叉驗
	// Input/Output。掛在同一個 chi router（humachi adapter）。
	humaCfg := huma.DefaultConfig("auth_service", "1.0.0")
	humaCfg.DocsPath = "/auth/docs"
	humaCfg.OpenAPIPath = "/auth/openapi"
	api := humachi.New(r, humaCfg)

	// 身份 / 健康
	huma.Get(api, "/auth/health", h.HumaHealth)
	huma.Get(api, "/auth/me", h.HumaMe)
	huma.Get(api, "/auth/me/permissions", h.HumaMePermissions)
	huma.Post(api, "/auth/logout", h.HumaLogout)

	// 登入 / 綁定 / refresh
	huma.Post(api, "/auth/line-token", h.HumaLineLogin)
	huma.Post(api, "/auth/line-bind", h.HumaLineBind)
	huma.Post(api, "/auth/refresh", h.HumaRefresh)
	huma.Post(api, "/auth/password-login", h.HumaPasswordLogin)
	huma.Post(api, "/auth/google", h.HumaGoogleLogin)

	// 管理後台 API（由 Nginx 先走 auth_request 擋掉非 super_admin）
	r.Get("/auth/admin/users", h.ListUsers)
	r.Post("/auth/admin/users", h.CreateUser)
	r.Post("/auth/admin/users/invite", h.InvitePatient)
	r.Patch("/auth/admin/users/{id}", h.UpdateUser)
	r.Delete("/auth/admin/users/{id}", h.DeleteUser)
	r.Post("/auth/admin/users/{id}/binding-token", h.RegenerateBindToken)
	r.Post("/auth/admin/users/{id}/unbind", h.UnbindUser)
	r.Post("/auth/admin/users/{id}/password", h.SetUserPassword)

	r.Get("/auth/admin/roles", h.ListRoles)
	r.Post("/auth/admin/roles", h.CreateRole)
	r.Delete("/auth/admin/roles/{id}", h.DeleteRole)
	r.Get("/auth/admin/roles/{id}/policies", h.GetRolePolicies)
	r.Put("/auth/admin/roles/{id}/policies", h.SetRolePolicies)

	r.Get("/auth/admin/policies", h.ListPolicies)
	r.Get("/auth/admin/policies/{id}", h.GetPolicy)
	r.Patch("/auth/admin/policies/{id}", h.UpdatePolicy)

	r.Get("/auth/admin/services", h.ListServices)
	r.Post("/auth/admin/invalidate", h.InvalidateCache)

	r.Get("/auth/admin/action-mappings", h.ListActionMappings)
	r.Post("/auth/admin/action-mappings", h.CreateActionMapping)
	r.Patch("/auth/admin/action-mappings/{id}", h.UpdateActionMapping)
	r.Delete("/auth/admin/action-mappings/{id}", h.DeleteActionMapping)

	r.Get("/auth/admin/tenants", h.ListTenants)
	r.Post("/auth/admin/tenants", h.CreateTenant)
	r.Get("/auth/admin/tenants/{id}", h.GetTenant)
	r.Patch("/auth/admin/tenants/{id}", h.UpdateTenant)
	r.Delete("/auth/admin/tenants/{id}", h.DeleteTenant)
	r.Get("/auth/admin/tenants/{id}/services", h.GetTenantServices)
	r.Put("/auth/admin/tenants/{id}/services", h.SetTenantServices)
	r.Get("/auth/admin/tenants/{id}/roles", h.GetTenantRoles)
	r.Put("/auth/admin/tenants/{id}/roles", h.SetTenantRoles)

	// Dev-only：非 production 才掛上，handler 內也會再檢查一次
	if cfg.Env != "production" {
		huma.Post(api, "/auth/dev-login", h.HumaDevLogin)
		log.Println("dev-login endpoint enabled at POST /auth/dev-login")
	}

	log.Println("auth service listening on :8001")
	log.Fatal(http.ListenAndServe(":8001", r))
}
