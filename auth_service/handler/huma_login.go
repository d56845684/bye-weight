package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"auth_service/token"
)

// Batch 2：登入 / 綁定 / refresh / 密碼登入 / dev-login 全改 huma。
// 共用 cookie + token helpers 集中在本檔；LINE / dev-login 的純資料查詢 helper
// 留在各自檔案（login.go / dev_login.go）保留單檔責任。

// ===== Shared helpers =====

// sessionCookies 回一組 (access, refresh) Cookie，給 LineLogin / LineBind /
// PasswordLogin / DevLogin 共用；路徑 / SameSite / Secure 與舊實作一致。
func (h *Handler) sessionCookies(access, refresh string) []http.Cookie {
	secure := h.cfg.Env == "production"
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteStrictMode
	}
	return []http.Cookie{
		{
			Name:     "access_token",
			Value:    access,
			HttpOnly: true,
			Secure:   secure,
			SameSite: sameSite,
			Path:     "/",
			MaxAge:   int(h.cfg.AccessTokenExpire.Seconds()),
		},
		{
			Name:     "refresh_token",
			Value:    refresh,
			HttpOnly: true,
			Secure:   secure,
			SameSite: sameSite,
			Path:     "/auth/v1/refresh",
			MaxAge:   int(h.cfg.RefreshTokenExpire.Seconds()),
		},
	}
}

// issueSessionTokens 替指定 user 發 access + refresh JWT。
func (h *Handler) issueSessionTokens(u *userRow) (access, refresh string, err error) {
	access, err = token.Issue(u.ID, u.RoleName, u.TenantID, "access", h.cfg.AccessTokenExpire, h.cfg.JWTSecret)
	if err != nil {
		return
	}
	refresh, err = token.Issue(u.ID, u.RoleName, u.TenantID, "refresh", h.cfg.RefreshTokenExpire, h.cfg.JWTSecret)
	return
}

// logLoginEvent：huma 版本的 login_logs 寫入，不依賴 *http.Request。
// huma Input 用 header tag 把 IP / UA 拿進來再傳進這裡。
func logLoginEvent(ctx context.Context, db *pgxpool.Pool, userID int, ip, ua, method string) error {
	_, err := db.Exec(ctx, `
		INSERT INTO login_logs (user_id, ip, user_agent)
		VALUES ($1, $2, $3)`, userID, ip, method+" "+ua)
	return err
}

// pickClientIP 仿照 chi 版本的 clientIP(r)：X-Forwarded-For 第一個 IP 優先、
// 否則 X-Real-IP，都沒的話回空字串（由 huma 的 RemoteAddr fallback）。
func pickClientIP(xff, xrealip, remoteAddr string) string {
	if xff != "" {
		if i := strings.Index(xff, ","); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xrealip != "" {
		return xrealip
	}
	return remoteAddr
}

// requestMeta 共用欄位：每個 login handler 都要記錄客戶端 IP / UA。
// 放 Input struct 的 embedded 欄位讓 huma 自動解 header。
type requestMeta struct {
	XForwardedFor string `header:"X-Forwarded-For"`
	XRealIP       string `header:"X-Real-IP"`
	UserAgent     string `header:"User-Agent"`
}

type authIdentityBody struct {
	UserID   int    `json:"user_id"`
	Role     string `json:"role"`
	TenantID int    `json:"tenant_id"`
}

type authSessionOutput struct {
	SetCookie []http.Cookie `header:"Set-Cookie"`
	Body      authIdentityBody
}

// ===== LineLogin：POST /auth/line-token =====

type LineLoginInput struct {
	requestMeta
	Body struct {
		AccessToken string `json:"access_token" doc:"LINE access token from LIFF"`
	}
}

func (h *Handler) HumaLineLogin(ctx context.Context, in *LineLoginInput) (*authSessionOutput, error) {
	profile, err := verifyLineToken(in.Body.AccessToken)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid LINE token")
	}
	user, err := h.findUserByLineUUID(ctx, profile.UserID)
	if err != nil {
		return nil, huma.Error401Unauthorized("not bound — contact admin for a binding link")
	}
	access, refresh, err := h.issueSessionTokens(user)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
		pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "line")

	out := &authSessionOutput{SetCookie: h.sessionCookies(access, refresh)}
	out.Body.UserID = user.ID
	out.Body.Role = user.RoleName
	out.Body.TenantID = user.TenantID
	return out, nil
}

// ===== LineBind：POST /auth/line-bind =====

type LineBindInput struct {
	requestMeta
	Body struct {
		AccessToken  string `json:"access_token"  doc:"LINE access token from LIFF"`
		BindingToken string `json:"binding_token" doc:"admin 發的一次性綁定 token"`
	}
}

type LineBindOutput struct {
	SetCookie []http.Cookie `header:"Set-Cookie"`
	Body      struct {
		UserID int    `json:"user_id"`
		Role   string `json:"role"`
	}
}

func (h *Handler) HumaLineBind(ctx context.Context, in *LineBindInput) (*LineBindOutput, error) {
	if in.Body.AccessToken == "" || in.Body.BindingToken == "" {
		return nil, huma.Error400BadRequest("access_token and binding_token required")
	}

	profile, err := verifyLineToken(in.Body.AccessToken)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid LINE token")
	}

	userIDStr, err := h.rdb.Get(ctx, "bind:"+in.Body.BindingToken).Result()
	if errors.Is(err, redis.Nil) {
		return nil, huma.Error410Gone("binding token expired or invalid")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("token lookup failed")
	}
	userID, err := strconv.Atoi(userIDStr)
	if err != nil || userID <= 0 {
		return nil, huma.Error500InternalServerError("invalid stored user_id")
	}

	if err := h.ensureNotAlreadyBound(ctx, userID, profile.UserID); err != nil {
		return nil, huma.Error409Conflict(err.Error())
	}

	// unbind → 重發 binding-token → 重綁 的循環需要把 active 回復，否則即使綁完
	// 下次 LIFF 登入仍被 active=false 擋。
	if _, err := h.engine.DB().Exec(ctx,
		`UPDATE users SET line_uuid = $1, active = true WHERE id = $2`,
		profile.UserID, userID); err != nil {
		return nil, huma.Error500InternalServerError("bind failed: " + err.Error())
	}
	h.rdb.Del(ctx, "bind:"+in.Body.BindingToken)

	user, err := h.findUserByLineUUID(ctx, profile.UserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("post-bind lookup failed")
	}
	access, refresh, err := h.issueSessionTokens(user)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
		pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "line_bind")

	out := &LineBindOutput{SetCookie: h.sessionCookies(access, refresh)}
	out.Body.UserID = user.ID
	out.Body.Role = user.RoleName
	return out, nil
}

// ===== Refresh：POST /auth/refresh =====

type RefreshInput struct {
	RefreshToken http.Cookie `cookie:"refresh_token"`
}

type RefreshOutput struct {
	SetCookie []http.Cookie `header:"Set-Cookie"`
	Body      struct {
		Status string `json:"status" example:"refreshed"`
	}
}

func (h *Handler) HumaRefresh(ctx context.Context, in *RefreshInput) (*RefreshOutput, error) {
	if in.RefreshToken.Value == "" {
		return nil, huma.Error401Unauthorized("no refresh token")
	}
	claims, err := token.Parse(in.RefreshToken.Value, h.cfg.JWTSecret)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid refresh token")
	}
	if claims.TokenType != "refresh" {
		return nil, huma.Error401Unauthorized("not a refresh token")
	}
	if code, err := h.verifySession(ctx, claims); err != nil {
		return nil, huma.NewError(code, err.Error())
	}
	access, err := token.Issue(
		claims.UserID, claims.Role, claims.TenantID,
		"access", h.cfg.AccessTokenExpire, h.cfg.JWTSecret,
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	// 只更新 access_token；refresh 本身不動（保留原本舊設計）
	secure := h.cfg.Env == "production"
	out := &RefreshOutput{
		SetCookie: []http.Cookie{
			{
				Name:     "access_token",
				Value:    access,
				HttpOnly: true,
				Secure:   secure,
				SameSite: http.SameSiteStrictMode,
				MaxAge:   int(h.cfg.AccessTokenExpire.Seconds()),
				Path:     "/",
			},
		},
	}
	out.Body.Status = "refreshed"
	return out, nil
}

// ===== PasswordLogin：POST /auth/password-login =====

type PasswordLoginInput struct {
	requestMeta
	Body struct {
		Email    string `json:"email"    doc:"使用者 email（存在 users.google_email 欄位）"`
		Password string `json:"password" doc:"明文密碼，server 端 bcrypt 比對"`
	}
}

func (h *Handler) HumaPasswordLogin(ctx context.Context, in *PasswordLoginInput) (*authSessionOutput, error) {
	if in.Body.Email == "" || in.Body.Password == "" {
		return nil, huma.Error400BadRequest("email and password required")
	}
	user, hash, err := h.findUserWithPassword(ctx, in.Body.Email)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Body.Password)); err != nil {
		return nil, huma.Error401Unauthorized("invalid credentials")
	}
	access, refresh, err := h.issueSessionTokens(user)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
		pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "password")

	out := &authSessionOutput{SetCookie: h.sessionCookies(access, refresh)}
	out.Body.UserID = user.ID
	out.Body.Role = user.RoleName
	out.Body.TenantID = user.TenantID
	return out, nil
}

// ===== DevLogin：POST /auth/dev-login =====
// 僅 Env != production 會註冊；再加 handler 內二次防線。

type DevLoginInput struct {
	requestMeta
	Body struct {
		UserID   int    `json:"user_id,omitempty"   doc:"指定 user_id（優先）"`
		LineUUID string `json:"line_uuid,omitempty" doc:"指定 line_uuid；兩者皆空時預設 dev-admin"`
	}
}

type DevLoginOutput struct {
	SetCookie []http.Cookie `header:"Set-Cookie"`
	Body      struct {
		UserID      int    `json:"user_id"`
		Role        string `json:"role"`
		TenantID    int    `json:"tenant_id"`
		AccessToken string `json:"access_token" doc:"方便 curl 直接帶 Cookie 的 debug 欄位"`
	}
}

func (h *Handler) HumaDevLogin(ctx context.Context, in *DevLoginInput) (*DevLoginOutput, error) {
	if h.cfg.Env == "production" {
		return nil, huma.Error404NotFound("not found")
	}
	user, err := h.findUserForDevLogin(ctx, devLoginRequest{UserID: in.Body.UserID, LineUUID: in.Body.LineUUID})
	if err != nil {
		return nil, huma.Error401Unauthorized("user not found (run migrations to seed dev-admin)")
	}
	access, refresh, err := h.issueSessionTokens(user)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
		pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "dev")

	out := &DevLoginOutput{SetCookie: h.sessionCookies(access, refresh)}
	out.Body.UserID = user.ID
	out.Body.Role = user.RoleName
	out.Body.TenantID = user.TenantID
	out.Body.AccessToken = access
	return out, nil
}

// ===== GoogleLogin：POST /auth/google（stub）=====

type GoogleLoginOutput struct {
	Body struct {
		Status string `json:"status"`
	}
}

func (h *Handler) HumaGoogleLogin(ctx context.Context, _ *struct{}) (*GoogleLoginOutput, error) {
	return nil, huma.NewError(http.StatusNotImplemented, "not implemented")
}
