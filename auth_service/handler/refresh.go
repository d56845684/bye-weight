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

	revoked, err := token.IsRevoked(r.Context(), h.rdb, claims.ID)
	if err != nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	if revoked {
		http.Error(w, "token revoked", http.StatusUnauthorized)
		return
	}

	// 停用的 user 不給換新 access token
	var active bool
	if err := h.engine.DB().QueryRow(r.Context(),
		`SELECT active FROM users WHERE id = $1`, claims.UserID).Scan(&active); err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}
	if !active {
		http.Error(w, "account disabled", http.StatusUnauthorized)
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
