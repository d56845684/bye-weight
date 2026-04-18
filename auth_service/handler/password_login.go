package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"golang.org/x/crypto/bcrypt"

	"auth_service/token"
)

type passwordLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// PasswordLogin：POST /auth/password-login
// 後台管理員用（super_admin / admin），以 email + 密碼驗證
func (h *Handler) PasswordLogin(w http.ResponseWriter, r *http.Request) {
	var req passwordLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Email == "" || req.Password == "" {
		http.Error(w, "email and password required", http.StatusBadRequest)
		return
	}

	user, hash, err := h.findUserWithPassword(r.Context(), req.Email)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	accessToken, err := token.Issue(
		user.ID, user.RoleName, user.TenantID,
		"access", h.cfg.AccessTokenExpire, h.cfg.JWTSecret,
	)
	if err != nil {
		http.Error(w, "token issue failed", http.StatusInternalServerError)
		return
	}
	refreshToken, err := token.Issue(
		user.ID, user.RoleName, user.TenantID,
		"refresh", h.cfg.RefreshTokenExpire, h.cfg.JWTSecret,
	)
	if err != nil {
		http.Error(w, "token issue failed", http.StatusInternalServerError)
		return
	}

	secure := h.cfg.Env == "production"
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteStrictMode
	}

	http.SetCookie(w, &http.Cookie{
		Name: "access_token", Value: accessToken, HttpOnly: true,
		Secure: secure, SameSite: sameSite, Path: "/",
		MaxAge: int(h.cfg.AccessTokenExpire.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name: "refresh_token", Value: refreshToken, HttpOnly: true,
		Secure: secure, SameSite: sameSite, Path: "/auth/v1/refresh",
		MaxAge: int(h.cfg.RefreshTokenExpire.Seconds()),
	})

	_ = logLogin(r.Context(), h.engine.DB(), user.ID, r, "password")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":   user.ID,
		"role":      user.RoleName,
		"tenant_id": user.TenantID,
	})
}

func (h *Handler) findUserWithPassword(ctx context.Context, email string) (*userRow, string, error) {
	var u userRow
	var hash string
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id, u.password_hash
		FROM users u JOIN roles r ON u.role_id = r.id
		WHERE u.google_email = $1 AND u.active = true AND u.password_hash IS NOT NULL
	`, email).Scan(&u.ID, &u.RoleName, &u.TenantID, &hash)
	if err != nil {
		return nil, "", err
	}
	return &u, hash, nil
}
