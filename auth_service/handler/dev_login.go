package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"auth_service/token"
)

type devLoginRequest struct {
	UserID   int    `json:"user_id,omitempty"`
	LineUUID string `json:"line_uuid,omitempty"`
}

// DevLogin：僅供非 production 環境測試使用。
// 直接查 users 表發 JWT cookie，無需 LINE / Google OAuth。
// 預設 line_uuid=dev-admin（由 000003 migration seed）。
func (h *Handler) DevLogin(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Env == "production" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var req devLoginRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // body 可選

	user, err := h.findUserForDevLogin(r.Context(), req)
	if err != nil {
		http.Error(w, "user not found (run migrations to seed dev-admin)", http.StatusUnauthorized)
		return
	}

	accessToken, err := token.Issue(
		user.ID, user.RoleName, user.ClinicID, user.PatientID,
		"access", h.cfg.AccessTokenExpire, h.cfg.JWTSecret,
	)
	if err != nil {
		http.Error(w, "token issue failed", http.StatusInternalServerError)
		return
	}

	refreshToken, err := token.Issue(
		user.ID, user.RoleName, user.ClinicID, user.PatientID,
		"refresh", h.cfg.RefreshTokenExpire, h.cfg.JWTSecret,
	)
	if err != nil {
		http.Error(w, "token issue failed", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "access_token",
		Value:    accessToken,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.cfg.AccessTokenExpire.Seconds()),
		Path:     "/",
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.cfg.RefreshTokenExpire.Seconds()),
		Path:     "/auth/refresh",
	})

	_ = logLogin(r.Context(), h.engine.DB(), user.ID, r, "dev")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":      user.ID,
		"role":         user.RoleName,
		"clinic_id":    user.ClinicID,
		"patient_id":   user.PatientID,
		"access_token": accessToken, // 方便 curl 測試直接帶 Cookie
	})
}

func (h *Handler) findUserForDevLogin(ctx context.Context, req devLoginRequest) (*userRow, error) {
	var u userRow
	var err error
	switch {
	case req.UserID > 0:
		err = h.engine.DB().QueryRow(ctx, `
			SELECT u.id, r.name, u.clinic_id, COALESCE(u.patient_id, 0)
			FROM users u JOIN roles r ON u.role_id = r.id
			WHERE u.id = $1 AND u.active = true
		`, req.UserID).Scan(&u.ID, &u.RoleName, &u.ClinicID, &u.PatientID)
	default:
		lineUUID := req.LineUUID
		if lineUUID == "" {
			lineUUID = "dev-admin"
		}
		err = h.engine.DB().QueryRow(ctx, `
			SELECT u.id, r.name, u.clinic_id, COALESCE(u.patient_id, 0)
			FROM users u JOIN roles r ON u.role_id = r.id
			WHERE u.line_uuid = $1 AND u.active = true
		`, lineUUID).Scan(&u.ID, &u.RoleName, &u.ClinicID, &u.PatientID)
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
