package handler

import (
	"encoding/json"
	"net/http"

	"auth_service/token"
)

// Me：給前端用，取得當前登入者身份資訊
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":    claims.UserID,
		"role":       claims.Role,
		"clinic_id":  claims.ClinicID,
		"patient_id": claims.PatientID,
	})
}
