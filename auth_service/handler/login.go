package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"auth_service/token"
)

type lineTokenRequest struct {
	AccessToken string `json:"access_token"`
}

type lineProfile struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
}

func (h *Handler) LineLogin(w http.ResponseWriter, r *http.Request) {
	var req lineTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// 向 LINE 驗證 access token
	profile, err := verifyLineToken(req.AccessToken)
	if err != nil {
		http.Error(w, "invalid LINE token", http.StatusUnauthorized)
		return
	}

	// 查詢 auth_db.users（走「先建後綁」流程，找不到就回 401 引導至管理員要綁定連結）
	user, err := h.findUserByLineUUID(r.Context(), profile.UserID)
	if err != nil {
		http.Error(w, "not bound — contact admin for a binding link", http.StatusUnauthorized)
		return
	}

	// 發行 JWT
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

	// Set cookies
	http.SetCookie(w, &http.Cookie{
		Name:     "access_token",
		Value:    accessToken,
		HttpOnly: true,
		Secure:   h.cfg.Env == "production",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(h.cfg.AccessTokenExpire.Seconds()),
		Path:     "/",
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HttpOnly: true,
		Secure:   h.cfg.Env == "production",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(h.cfg.RefreshTokenExpire.Seconds()),
		Path:     "/auth/refresh",
	})

	_ = logLogin(r.Context(), h.engine.DB(), user.ID, r, "line")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user_id": user.ID,
		"role":    user.RoleName,
	})
}

func (h *Handler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	// TODO: Google OAuth 驗證 + JWT 發行（與 LineLogin 類似）
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

func verifyLineToken(accessToken string) (*lineProfile, error) {
	req, _ := http.NewRequest("GET", "https://api.line.me/v2/profile", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("LINE API error: %s", body)
	}

	var profile lineProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, err
	}
	return &profile, nil
}

type userRow struct {
	ID        int
	RoleName  string
	ClinicID  string
	PatientID int
}

func (h *Handler) findUserByLineUUID(ctx context.Context, lineUUID string) (*userRow, error) {
	// 使用 engine 的 DB pool
	var u userRow
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.clinic_id, COALESCE(u.patient_id, 0)
		FROM users u
		JOIN roles r ON u.role_id = r.id
		WHERE u.line_uuid = $1 AND u.active = true
	`, lineUUID).Scan(&u.ID, &u.RoleName, &u.ClinicID, &u.PatientID)
	if err != nil {
		return nil, err
	}
	return &u, nil
}
