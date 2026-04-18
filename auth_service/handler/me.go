package handler

import (
	"encoding/json"
	"net/http"

	"auth_service/token"
)

// Me：給前端用，取得當前登入者 identity
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("access_token")
	if err != nil {
		http.Error(w, "no token", http.StatusUnauthorized)
		return
	}
	claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
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

	// 停用的 user 也應被擋
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

	// user-level 吊銷檢查
	if claims.IssuedAt != nil {
		if userRevoked, err := token.IsUserRevoked(r.Context(), h.rdb, claims.UserID, claims.IssuedAt.Time); err != nil {
			http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			return
		} else if userRevoked {
			http.Error(w, "session revoked by admin", http.StatusUnauthorized)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":   claims.UserID,
		"role":      claims.Role,
		"tenant_id": claims.TenantID,
	})
}
