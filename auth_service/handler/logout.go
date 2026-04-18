package handler

import (
	"encoding/json"
	"net/http"

	"auth_service/token"
)

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	// 撤銷 access token
	if cookie, err := r.Cookie("access_token"); err == nil {
		if claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret); err == nil {
			token.Revoke(r.Context(), h.rdb, claims.ID, claims.ExpiresAt.Time)
		}
	}

	// 撤銷 refresh token
	if cookie, err := r.Cookie("refresh_token"); err == nil {
		if claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret); err == nil {
			token.Revoke(r.Context(), h.rdb, claims.ID, claims.ExpiresAt.Time)
		}
	}

	// 清除 cookies
	http.SetCookie(w, &http.Cookie{
		Name:     "access_token",
		Value:    "",
		HttpOnly: true,
		Secure:   h.cfg.Env == "production",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
		Path:     "/",
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    "",
		HttpOnly: true,
		Secure:   h.cfg.Env == "production",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
		Path:     "/auth/v1/refresh",
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "logged out"})
}
