package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/redis/go-redis/v9"

	"auth_service/token"
)

type lineBindRequest struct {
	AccessToken  string `json:"access_token"`
	BindingToken string `json:"binding_token"`
}

// LineBind：POST /auth/line-bind
// 使用者在 LIFF 內，帶著 LINE access token + admin 發的 binding token 來綁定
// 成功後把 line_uuid 寫回 users row，並發 JWT cookie
func (h *Handler) LineBind(w http.ResponseWriter, r *http.Request) {
	var req lineBindRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.AccessToken == "" || req.BindingToken == "" {
		http.Error(w, "access_token and binding_token required", http.StatusBadRequest)
		return
	}

	// 1. 驗 LINE access token 取 line_uuid
	profile, err := verifyLineToken(req.AccessToken)
	if err != nil {
		http.Error(w, "invalid LINE token", http.StatusUnauthorized)
		return
	}

	// 2. 查 Redis binding token 對應的 user_id
	ctx := r.Context()
	userIDStr, err := h.rdb.Get(ctx, "bind:"+req.BindingToken).Result()
	if errors.Is(err, redis.Nil) {
		http.Error(w, "binding token expired or invalid", http.StatusGone)
		return
	}
	if err != nil {
		http.Error(w, "token lookup failed", http.StatusInternalServerError)
		return
	}
	userID, err := strconv.Atoi(userIDStr)
	if err != nil {
		http.Error(w, "invalid stored user_id", http.StatusInternalServerError)
		return
	}

	// 3. 檢查這個 line_uuid 還沒被綁走 + 這個 user 也還沒被綁
	if err := h.ensureNotAlreadyBound(ctx, userID, profile.UserID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	// 4. 更新 users.line_uuid + 一次性消耗 token
	if _, err := h.engine.DB().Exec(ctx, `
		UPDATE users SET line_uuid = $1 WHERE id = $2`,
		profile.UserID, userID); err != nil {
		http.Error(w, "bind failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	h.rdb.Del(ctx, "bind:"+req.BindingToken)

	// 5. 查 user 完整資料發 JWT
	user, err := h.findUserByLineUUID(ctx, profile.UserID)
	if err != nil {
		http.Error(w, "post-bind lookup failed", http.StatusInternalServerError)
		return
	}

	access, _ := token.Issue(
		user.ID, user.RoleName, user.TenantID,
		"access", h.cfg.AccessTokenExpire, h.cfg.JWTSecret,
	)
	refresh, _ := token.Issue(
		user.ID, user.RoleName, user.TenantID,
		"refresh", h.cfg.RefreshTokenExpire, h.cfg.JWTSecret,
	)

	secure := h.cfg.Env == "production"
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteStrictMode
	}
	http.SetCookie(w, &http.Cookie{
		Name: "access_token", Value: access, HttpOnly: true, Secure: secure,
		SameSite: sameSite, Path: "/", MaxAge: int(h.cfg.AccessTokenExpire.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name: "refresh_token", Value: refresh, HttpOnly: true, Secure: secure,
		SameSite: sameSite, Path: "/auth/v1/refresh", MaxAge: int(h.cfg.RefreshTokenExpire.Seconds()),
	})
	_ = logLogin(ctx, h.engine.DB(), user.ID, r, "line_bind")

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id": user.ID,
		"role":    user.RoleName,
	})
}

func (h *Handler) ensureNotAlreadyBound(ctx context.Context, userID int, lineUUID string) error {
	// user 是否已綁過
	var existing *string
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT line_uuid FROM users WHERE id = $1`, userID).Scan(&existing); err != nil {
		return err
	}
	if existing != nil && *existing != "" {
		return errors.New("user already bound")
	}
	// 此 LINE UUID 是否已綁到其他 user
	var otherID *int
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT id FROM users WHERE line_uuid = $1`, lineUUID).Scan(&otherID); err != nil {
		// pgx: errNoRows 走這條代表沒綁過 → 放行
		if err.Error() == "no rows in result set" {
			return nil
		}
		return nil // 其他錯誤就放行到 UPDATE 自行失敗
	}
	if otherID != nil {
		return errors.New("this LINE account is already bound to another user")
	}
	return nil
}
