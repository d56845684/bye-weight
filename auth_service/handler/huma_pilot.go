package handler

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"auth_service/engine"
	"auth_service/token"
)

// huma-style handlers pilot: Me / MePermissions / Health / Logout。
// OpenAPI spec 從 Input / Output struct 的 json tag 自動推導；request
// validation（cookie 必備、body schema 等）由 huma 在進 handler 前擋掉，
// handler 裡只剩領域邏輯。
//
// 舊 (w http.ResponseWriter, r *http.Request) 版本已從 main.go 拔線（函式本身
// 保留，未來要一起砍）。

// ===== 共用 Input：只吃 access_token cookie =====
type authCookieInput struct {
	AccessToken http.Cookie `cookie:"access_token"`
}

// ===== Health =====

type HealthOutput struct {
	Body struct {
		Status string `json:"status" example:"ok" doc:"Liveness 狀態固定回 ok"`
	}
}

func (h *Handler) HumaHealth(ctx context.Context, _ *struct{}) (*HealthOutput, error) {
	out := &HealthOutput{}
	out.Body.Status = "ok"
	return out, nil
}

// ===== Me =====

type MeOutput struct {
	Body struct {
		UserID   int    `json:"user_id"   doc:"auth_db.users.id"`
		Role     string `json:"role"      example:"patient"`
		TenantID int    `json:"tenant_id" doc:"0 = system tenant（super_admin 專用）"`
	}
}

func (h *Handler) HumaMe(ctx context.Context, in *authCookieInput) (*MeOutput, error) {
	claims, code, err := h.verifyIdentityFromCookie(ctx, in.AccessToken.Value)
	if err != nil {
		return nil, huma.NewError(code, err.Error())
	}
	out := &MeOutput{}
	out.Body.UserID = claims.UserID
	out.Body.Role = claims.Role
	out.Body.TenantID = claims.TenantID
	return out, nil
}

// ===== MePermissions =====

type MePermissionsOutput struct {
	Body struct {
		Role     string   `json:"role"`
		TenantID int      `json:"tenant_id"`
		Actions  []string `json:"actions" doc:"該 role 被 allow 的 action pattern（glob）"`
	}
}

func (h *Handler) HumaMePermissions(ctx context.Context, in *authCookieInput) (*MePermissionsOutput, error) {
	claims, code, err := h.verifyIdentityFromCookie(ctx, in.AccessToken.Value)
	if err != nil {
		return nil, huma.NewError(code, err.Error())
	}
	actions := h.engine.ResolveActionsForSubject(engine.Subject{
		UserID:   claims.UserID,
		Role:     claims.Role,
		TenantID: claims.TenantID,
	})
	out := &MePermissionsOutput{}
	out.Body.Role = claims.Role
	out.Body.TenantID = claims.TenantID
	out.Body.Actions = actions
	return out, nil
}

// ===== Logout =====

type LogoutInput struct {
	AccessToken  http.Cookie `cookie:"access_token"`
	RefreshToken http.Cookie `cookie:"refresh_token"`
}

type LogoutOutput struct {
	SetCookie []http.Cookie `header:"Set-Cookie"`
	Body      struct {
		Status string `json:"status" example:"logged out"`
	}
}

func (h *Handler) HumaLogout(ctx context.Context, in *LogoutInput) (*LogoutOutput, error) {
	// best-effort：撤銷兩顆 token（解析失敗就放過）
	if in.AccessToken.Value != "" {
		if c, err := token.Parse(in.AccessToken.Value, h.cfg.JWTSecret); err == nil {
			_ = token.Revoke(ctx, h.rdb, c.ID, c.ExpiresAt.Time)
		}
	}
	if in.RefreshToken.Value != "" {
		if c, err := token.Parse(in.RefreshToken.Value, h.cfg.JWTSecret); err == nil {
			_ = token.Revoke(ctx, h.rdb, c.ID, c.ExpiresAt.Time)
		}
	}

	secure := h.cfg.Env == "production"
	out := &LogoutOutput{}
	out.SetCookie = []http.Cookie{
		{
			Name:     "access_token",
			Value:    "",
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
			Path:     "/",
		},
		{
			Name:     "refresh_token",
			Value:    "",
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
			Path:     "/auth/v1/refresh",
		},
	}
	out.Body.Status = "logged out"
	return out, nil
}
