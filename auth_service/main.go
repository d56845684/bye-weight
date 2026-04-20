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

	// 管理後台 users API — 全 huma（batch 3）
	huma.Get(api, "/auth/admin/users", h.HumaListUsers)
	huma.Post(api, "/auth/admin/users", h.HumaCreateUser)
	huma.Post(api, "/auth/admin/users/invite", h.HumaInvitePatient)
	huma.Patch(api, "/auth/admin/users/{id}", h.HumaUpdateUser)
	huma.Delete(api, "/auth/admin/users/{id}", h.HumaDeleteUser)
	huma.Post(api, "/auth/admin/users/{id}/binding-token", h.HumaRegenerateBindToken)
	huma.Post(api, "/auth/admin/users/{id}/unbind", h.HumaUnbindUser)
	huma.Post(api, "/auth/admin/users/{id}/password", h.HumaSetUserPassword)

	// 管理後台 roles / policies — 全 huma（batch 4）
	huma.Get(api, "/auth/admin/roles", h.HumaListRoles)
	huma.Post(api, "/auth/admin/roles", h.HumaCreateRole)
	huma.Delete(api, "/auth/admin/roles/{id}", h.HumaDeleteRole)
	huma.Get(api, "/auth/admin/roles/{id}/policies", h.HumaGetRolePolicies)
	huma.Put(api, "/auth/admin/roles/{id}/policies", h.HumaSetRolePolicies)

	huma.Get(api, "/auth/admin/policies", h.HumaListPolicies)
	huma.Get(api, "/auth/admin/policies/{id}", h.HumaGetPolicy)
	huma.Patch(api, "/auth/admin/policies/{id}", h.HumaUpdatePolicy)

	// Services / invalidate / action-mappings — 全 huma（batch 5b）
	huma.Get(api, "/auth/admin/services", h.HumaListServices)
	huma.Post(api, "/auth/admin/invalidate", h.HumaInvalidateCache)

	huma.Get(api, "/auth/admin/action-mappings", h.HumaListActionMappings)
	huma.Post(api, "/auth/admin/action-mappings", h.HumaCreateActionMapping)
	huma.Patch(api, "/auth/admin/action-mappings/{id}", h.HumaUpdateActionMapping)
	huma.Delete(api, "/auth/admin/action-mappings/{id}", h.HumaDeleteActionMapping)

	// Tenants — 全 huma（batch 5a）
	huma.Get(api, "/auth/admin/tenants", h.HumaListTenants)
	huma.Post(api, "/auth/admin/tenants", h.HumaCreateTenant)
	huma.Get(api, "/auth/admin/tenants/{id}", h.HumaGetTenant)
	huma.Patch(api, "/auth/admin/tenants/{id}", h.HumaUpdateTenant)
	huma.Delete(api, "/auth/admin/tenants/{id}", h.HumaDeleteTenant)
	huma.Get(api, "/auth/admin/tenants/{id}/services", h.HumaGetTenantServices)
	huma.Put(api, "/auth/admin/tenants/{id}/services", h.HumaSetTenantServices)
	huma.Get(api, "/auth/admin/tenants/{id}/roles", h.HumaGetTenantRoles)
	huma.Put(api, "/auth/admin/tenants/{id}/roles", h.HumaSetTenantRoles)

	// Dev-only：非 production 才掛上，handler 內也會再檢查一次
	if cfg.Env != "production" {
		huma.Post(api, "/auth/dev-login", h.HumaDevLogin)
		log.Println("dev-login endpoint enabled at POST /auth/dev-login")
	}

	log.Println("auth service listening on :8001")
	log.Fatal(http.ListenAndServe(":8001", r))
}
