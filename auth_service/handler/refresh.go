package handler

import (
	"encoding/json"
	"net/http"

	"auth_service/token"
)

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		http.Error(w, "no refresh token", http.StatusUnauthorized)
		return
	}

	claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret)
	if err != nil {
		http.Error(w, "invalid refresh token", http.StatusUnauthorized)
		return
	}
	if claims.TokenType != "refresh" {
		http.Error(w, "not a refresh token", http.StatusUnauthorized)
		return
	}

	// 共用 verifySession：blacklist + user.active + tenant.active + user_revoke
	if code, err := h.verifySession(r.Context(), claims); err != nil {
		http.Error(w, err.Error(), code)
		return
	}

	accessToken, err := token.Issue(
		claims.UserID, claims.Role, claims.TenantID,
		"access", h.cfg.AccessTokenExpire, h.cfg.JWTSecret,
	)
	if err != nil {
		http.Error(w, "token issue failed", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "access_token",
		Value:    accessToken,
		HttpOnly: true,
		Secure:   h.cfg.Env == "production",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(h.cfg.AccessTokenExpire.Seconds()),
		Path:     "/",
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "refreshed"})
}
