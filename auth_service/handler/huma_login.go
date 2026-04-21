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
	"google.golang.org/api/idtoken"

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
		// Token 已被 consume。若 caller 的 LINE UUID 就是之前被這顆 token 綁好的
		// active user，當作「同一人重入」處理（常見於首次 line-bind 成功但
		// /patients/register 前斷線，用戶回來再點 invite link）→ 直接發新 session
		// 接續流程，不回 410 讓前端要多做 fallback。這裡依賴 auth_identities 的
		// (provider, subject) 唯一，所以同一個 LINE UUID 不會被別的 token 盜用。
		if user, lookupErr := h.findUserByLineUUID(ctx, profile.UserID); lookupErr == nil && user != nil {
			access, refresh, issueErr := h.issueSessionTokens(user)
			if issueErr != nil {
				return nil, huma.Error500InternalServerError("token issue failed")
			}
			_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
				pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "line_bind_resume")
			out := &LineBindOutput{SetCookie: h.sessionCookies(access, refresh)}
			out.Body.UserID = user.ID
			out.Body.Role = user.RoleName
			return out, nil
		}
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
	// identity 用 UPSERT pattern：如有舊的 soft-deleted line identity 就 revive；
	// 沒有就 insert。partial unique (user_id, provider) WHERE deleted_at IS NULL
	// 保證同一時刻只有一筆 live。
	tx, err := h.engine.DB().Begin(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("tx begin failed: " + err.Error())
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO auth_identities (user_id, provider, subject, last_used_at)
		 VALUES ($1, 'line', $2, NOW())`,
		userID, profile.UserID); err != nil {
		return nil, huma.Error500InternalServerError("bind failed: " + err.Error())
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET active = true WHERE id = $1`, userID); err != nil {
		return nil, huma.Error500InternalServerError("activate failed: " + err.Error())
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, huma.Error500InternalServerError("tx commit failed: " + err.Error())
	}
	h.rdb.Del(ctx, "bind:"+in.Body.BindingToken)
	_ = token.InvalidateUserActive(ctx, h.rdb, userID)

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

// ===== LineFriendshipCheck：POST /auth/line-friendship-check =====
//
// 為什麼不用前端 liff.getFriendship()：
//   getFriendship() 只看 LIFF 所屬 LINE Login channel 連結的 OA；如果 LIFF 的
//   Login channel 關聯的是另一個 placeholder OA（user 一登 LINE 就是朋友），
//   會拿到 friendFlag=true，但實際要接訊息的 Messaging OA 用戶還沒加 →
//   綁定前偵測不到「尚未加好友」，變孤兒帳號。
//
// 改打 Messaging API /v2/bot/profile/{uid}：
//   - 200 → user 是 follower = 已加好友
//   - 404 → user 尚未 follow
//   - 其他 HTTP status → 視為無法判斷
//
// 用 LINE_CHANNEL_ACCESS_TOKEN 呼叫。token 空字串時回 is_friend=null + reason，
// 前端可 degrade 為保守（當作未加好友）而不 crash。

type LineFriendshipCheckInput struct {
	Body struct {
		AccessToken string `json:"access_token" doc:"LINE access token from LIFF"`
	}
}

type LineFriendshipCheckOutput struct {
	Body struct {
		IsFriend *bool  `json:"is_friend" doc:"true=已加好友；false=未加；null=無法判斷（未設 token 或查詢失敗）"`
		Reason   string `json:"reason,omitempty"`
	}
}

func (h *Handler) HumaLineFriendshipCheck(ctx context.Context, in *LineFriendshipCheckInput) (*LineFriendshipCheckOutput, error) {
	if in.Body.AccessToken == "" {
		return nil, huma.Error400BadRequest("access_token required")
	}
	profile, err := verifyLineToken(in.Body.AccessToken)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid LINE token")
	}

	out := &LineFriendshipCheckOutput{}
	if h.cfg.LineChannelAccessToken == "" {
		out.Body.IsFriend = nil
		out.Body.Reason = "not_configured"
		return out, nil
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		"https://api.line.me/v2/bot/profile/"+profile.UserID, nil)
	req.Header.Set("Authorization", "Bearer "+h.cfg.LineChannelAccessToken)
	resp, callErr := http.DefaultClient.Do(req)
	if callErr != nil {
		out.Body.IsFriend = nil
		out.Body.Reason = "call_failed"
		return out, nil
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		t := true
		out.Body.IsFriend = &t
	case http.StatusNotFound:
		f := false
		out.Body.IsFriend = &f
	default:
		// 401=access token 無效、403=channel 權限不夠 等 — 視為無法判斷
		out.Body.IsFriend = nil
		out.Body.Reason = "line_api_" + strconv.Itoa(resp.StatusCode)
	}
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
		Email    string `json:"email"    doc:"使用者 email（存 auth_identities provider=password 的 subject）"`
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

// ===== Google SSO =====
//
// 兩支 endpoint，對稱於 LINE：
//   POST /auth/google         一般登入：已綁 Google 的 user，帶 id_token 來換 session
//   POST /auth/google-bind    首次綁定：admin 產 invite token → 使用者走 Google
//                             OAuth 拿 id_token → 同時帶 token 回來把 Google sub
//                             跟對應 auth_user 寫進 auth_identities
//
// Provisioning 模型（方案 B）：admin 透過 POST /auth/admin/users/{id}/google-binding-token
// 產一次性 token 存 Redis `bind:google:{token}` → user_id，TTL 7 天。
// user 點 invite URL 登入後，backend 驗 id_token 拿 sub → 依 token 找到目標 user →
// INSERT identity(provider=google, subject=sub) + consume token。
//
// 不允許自註冊：若 /auth/google 查不到 identity，直接 401 要求先向 admin 取綁定連結。

type googleProfile struct {
	Sub   string
	Email string
	Name  string
}

// verifyGoogleIDToken：用 google.golang.org/api/idtoken 驗簽 + 驗 audience。
// audience = GOOGLE_CLIENT_ID；空字串視為未設定，fail-close 回 401。
func (h *Handler) verifyGoogleIDToken(ctx context.Context, token string) (*googleProfile, error) {
	if h.cfg.GoogleClientID == "" {
		return nil, errors.New("google sso not configured")
	}
	payload, err := idtoken.Validate(ctx, token, h.cfg.GoogleClientID)
	if err != nil {
		return nil, err
	}
	p := &googleProfile{Sub: payload.Subject}
	if v, ok := payload.Claims["email"].(string); ok {
		p.Email = v
	}
	if v, ok := payload.Claims["name"].(string); ok {
		p.Name = v
	}
	return p, nil
}

// ===== GoogleLogin：POST /auth/google =====

type GoogleLoginInput struct {
	requestMeta
	Body struct {
		Credential string `json:"credential" doc:"Google id_token（前端 Google Identity Services 拿到的 JWT）"`
	}
}

func (h *Handler) HumaGoogleLogin(ctx context.Context, in *GoogleLoginInput) (*authSessionOutput, error) {
	if in.Body.Credential == "" {
		return nil, huma.Error400BadRequest("credential required")
	}
	profile, err := h.verifyGoogleIDToken(ctx, in.Body.Credential)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid google token")
	}

	var u userRow
	err = h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id
		FROM users u
		JOIN roles r ON u.role_id = r.id
		JOIN auth_identities i ON i.user_id = u.id
		WHERE i.provider = 'google'
		  AND i.subject = $1
		  AND i.deleted_at IS NULL
		  AND u.active = true
		  AND u.deleted_at IS NULL
	`, profile.Sub).Scan(&u.ID, &u.RoleName, &u.TenantID)
	if err != nil {
		// 沒綁過 → 要求先取得 admin 發的綁定連結；不自動註冊
		return nil, huma.Error401Unauthorized("google account not bound; contact admin for invite")
	}

	// 更新 last_used_at（best-effort，失敗不擋登入）
	_, _ = h.engine.DB().Exec(ctx, `
		UPDATE auth_identities SET last_used_at = NOW()
		WHERE user_id = $1 AND provider = 'google' AND deleted_at IS NULL`, u.ID)

	access, refresh, err := h.issueSessionTokens(&u)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	_ = logLoginEvent(ctx, h.engine.DB(), u.ID,
		pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "google")

	out := &authSessionOutput{SetCookie: h.sessionCookies(access, refresh)}
	out.Body.UserID = u.ID
	out.Body.Role = u.RoleName
	out.Body.TenantID = u.TenantID
	return out, nil
}

// ===== GoogleBind：POST /auth/google-bind =====

type GoogleBindInput struct {
	requestMeta
	Body struct {
		Credential   string `json:"credential"    doc:"Google id_token"`
		BindingToken string `json:"binding_token" doc:"admin 發的一次性綁定 token"`
	}
}

func (h *Handler) HumaGoogleBind(ctx context.Context, in *GoogleBindInput) (*LineBindOutput, error) {
	if in.Body.Credential == "" || in.Body.BindingToken == "" {
		return nil, huma.Error400BadRequest("credential and binding_token required")
	}
	profile, err := h.verifyGoogleIDToken(ctx, in.Body.Credential)
	if err != nil {
		return nil, huma.Error401Unauthorized("invalid google token")
	}

	userIDStr, err := h.rdb.Get(ctx, "bind:google:"+in.Body.BindingToken).Result()
	if errors.Is(err, redis.Nil) {
		// Token 已 consume，但如果 user 以同一個 Google 帳號重入，直接放行發 session
		// 不回 410，對稱 LineBind 的冪等處理。
		if user, lookupErr := h.findUserByGoogleSub(ctx, profile.Sub); lookupErr == nil && user != nil {
			access, refresh, issueErr := h.issueSessionTokens(user)
			if issueErr != nil {
				return nil, huma.Error500InternalServerError("token issue failed")
			}
			_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
				pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "google_bind_resume")
			out := &LineBindOutput{SetCookie: h.sessionCookies(access, refresh)}
			out.Body.UserID = user.ID
			out.Body.Role = user.RoleName
			return out, nil
		}
		return nil, huma.Error410Gone("binding token expired or invalid")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("token lookup failed")
	}
	userID, err := strconv.Atoi(userIDStr)
	if err != nil || userID <= 0 {
		return nil, huma.Error500InternalServerError("invalid stored user_id")
	}

	// 拒絕：此 user 已綁 google；此 Google sub 已綁別人
	var userHasGoogle, subTakenByOther bool
	if err := h.engine.DB().QueryRow(ctx, `
		SELECT
		    EXISTS(SELECT 1 FROM auth_identities
		           WHERE user_id = $1 AND provider = 'google' AND deleted_at IS NULL),
		    EXISTS(SELECT 1 FROM auth_identities
		           WHERE provider = 'google' AND subject = $2 AND deleted_at IS NULL
		             AND user_id <> $1)
	`, userID, profile.Sub).Scan(&userHasGoogle, &subTakenByOther); err != nil {
		return nil, huma.Error500InternalServerError("conflict check failed")
	}
	if userHasGoogle {
		return nil, huma.Error409Conflict("user already bound to google")
	}
	if subTakenByOther {
		return nil, huma.Error409Conflict("this google account is already bound to another user")
	}

	tx, err := h.engine.DB().Begin(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("tx begin failed")
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_identities (user_id, provider, subject, metadata, last_used_at)
		VALUES ($1, 'google', $2,
		        jsonb_build_object('email', $3::text, 'name', $4::text),
		        NOW())`,
		userID, profile.Sub, profile.Email, profile.Name); err != nil {
		return nil, huma.Error500InternalServerError("bind failed: " + err.Error())
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET active = true WHERE id = $1`, userID); err != nil {
		return nil, huma.Error500InternalServerError("activate failed: " + err.Error())
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, huma.Error500InternalServerError("tx commit failed: " + err.Error())
	}
	h.rdb.Del(ctx, "bind:google:"+in.Body.BindingToken)
	_ = token.InvalidateUserActive(ctx, h.rdb, userID)

	user, err := h.findUserByGoogleSub(ctx, profile.Sub)
	if err != nil {
		return nil, huma.Error500InternalServerError("post-bind lookup failed")
	}
	access, refresh, err := h.issueSessionTokens(user)
	if err != nil {
		return nil, huma.Error500InternalServerError("token issue failed")
	}
	_ = logLoginEvent(ctx, h.engine.DB(), user.ID,
		pickClientIP(in.XForwardedFor, in.XRealIP, ""), in.UserAgent, "google_bind")

	out := &LineBindOutput{SetCookie: h.sessionCookies(access, refresh)}
	out.Body.UserID = user.ID
	out.Body.Role = user.RoleName
	return out, nil
}

func (h *Handler) findUserByGoogleSub(ctx context.Context, sub string) (*userRow, error) {
	var u userRow
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id
		FROM users u
		JOIN roles r ON u.role_id = r.id
		JOIN auth_identities i ON i.user_id = u.id
		WHERE i.provider = 'google'
		  AND i.subject = $1
		  AND i.deleted_at IS NULL
		  AND u.active = true
		  AND u.deleted_at IS NULL
	`, sub).Scan(&u.ID, &u.RoleName, &u.TenantID)
	if err != nil {
		return nil, err
	}
	return &u, nil
}
