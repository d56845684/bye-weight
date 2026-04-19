package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"auth_service/engine"
	"auth_service/token"
)

// verifySession 接收已解析的 JWT claims，跑後續所有狀態檢查：
// blacklist → user.active → tenant.active → user_revoke。
// cookie 解析由 caller 負責（access_token 或 refresh_token），這個 helper 保證三條
// 驗證路徑的擋線行為一致，改一處就生效。收 context.Context 而非 *http.Request
// 是為了讓 huma handlers 也能直接呼叫（huma 只給 ctx）。
func (h *Handler) verifySession(ctx context.Context, claims *token.Claims) (int, error) {
	// fail-closed：Redis 故障時拒絕
	revoked, err := token.IsRevoked(ctx, h.rdb, claims.ID)
	if err != nil {
		return http.StatusServiceUnavailable, errors.New("service unavailable")
	}
	if revoked {
		return http.StatusUnauthorized, errors.New("token revoked")
	}

	// 確認使用者仍啟用（後台將 active=false 後應立即生效，不等 JWT 過期）
	var userActive bool
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT active FROM users WHERE id = $1`, claims.UserID).Scan(&userActive); err != nil {
		return http.StatusUnauthorized, errors.New("user not found")
	}
	if !userActive {
		return http.StatusUnauthorized, errors.New("account disabled")
	}

	// Tenant 停用 → 該租戶底下所有現役 session 立即擋下。
	// 系統 tenant（id=0，super_admin 專用）略過，避免誤操作鎖死後台。
	if claims.TenantID != 0 {
		var tenantActive bool
		if err := h.engine.DB().QueryRow(ctx,
			`SELECT active FROM tenants WHERE id = $1`, claims.TenantID).Scan(&tenantActive); err != nil {
			return http.StatusUnauthorized, errors.New("tenant not found")
		}
		if !tenantActive {
			return http.StatusUnauthorized, errors.New("tenant disabled")
		}
	}

	// 使用者層級吊銷：admin 拔 LINE 綁定 / 改角色 / 切 tenant 時會寫 Redis。
	// JWT 簽發時間早於吊銷時間就視為失效，不必等 JWT TTL 到期。
	if claims.IssuedAt != nil {
		userRevoked, err := token.IsUserRevoked(ctx, h.rdb, claims.UserID, claims.IssuedAt.Time)
		if err != nil {
			return http.StatusServiceUnavailable, errors.New("service unavailable")
		}
		if userRevoked {
			return http.StatusUnauthorized, errors.New("session revoked by admin")
		}
	}

	return http.StatusOK, nil
}

// verifyIdentity 是 chi handler 用的入口：從 *http.Request 拿 access_token cookie、
// 解 JWT、跑 verifySession。
func (h *Handler) verifyIdentity(r *http.Request) (*token.Claims, int, error) {
	cookie, err := r.Cookie("access_token")
	if err != nil {
		return nil, http.StatusUnauthorized, errors.New("no token")
	}
	claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret)
	if err != nil {
		return nil, http.StatusUnauthorized, errors.New("invalid token")
	}
	if code, err := h.verifySession(r.Context(), claims); err != nil {
		return nil, code, err
	}
	return claims, http.StatusOK, nil
}

// verifyIdentityFromCookie 是 huma handler 用的入口：cookie value 由 huma input
// struct 解好，這裡只做 parse + session checks。空字串（沒帶 cookie）直接 401。
func (h *Handler) verifyIdentityFromCookie(ctx context.Context, cookieValue string) (*token.Claims, int, error) {
	if cookieValue == "" {
		return nil, http.StatusUnauthorized, errors.New("no token")
	}
	claims, err := token.Parse(cookieValue, h.cfg.JWTSecret)
	if err != nil {
		return nil, http.StatusUnauthorized, errors.New("invalid token")
	}
	if code, err := h.verifySession(ctx, claims); err != nil {
		return nil, code, err
	}
	return claims, http.StatusOK, nil
}

// Verify 對應 Nginx 的 /api/v1 auth_request：除了身份檢查還會解析 action
// mapping、評估 policy，通過才回 200。失敗會以 401 / 403 / 5xx 區別原因。
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	claims, code, err := h.verifyIdentity(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}

	method := r.Header.Get("X-Original-Method")
	uri := r.Header.Get("X-Original-URI")

	sub := engine.Subject{
		UserID:   claims.UserID,
		Role:     claims.Role,
		TenantID: claims.TenantID,
	}

	action, template, pathAttrs, serviceName, ok := h.engine.ResolveAction(method, uri)
	if !ok {
		// 沒有對應規則 → implicit deny
		http.Error(w, "no action mapping for "+method+" "+uri, http.StatusForbidden)
		return
	}

	// tenant 必須訂閱該 service（system tenant 永遠訂全部）
	if !h.engine.IsServiceEnabled(sub.TenantID, serviceName) {
		http.Error(w, "service '"+serviceName+"' not enabled for tenant", http.StatusForbidden)
		return
	}

	resource := engine.SubstituteResource(template, sub, pathAttrs)

	if !h.engine.Check(sub, action, resource) {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}

	// 通過：注入上下文 header 給主服務
	w.Header().Set("X-User-Id", strconv.Itoa(claims.UserID))
	w.Header().Set("X-User-Role", claims.Role)
	w.Header().Set("X-Tenant-Id", strconv.Itoa(claims.TenantID))
	w.WriteHeader(http.StatusOK)
}

// VerifyPage 對應 Nginx 掛在前端頁面（/patient /staff /nutritionist）的 auth_request。
// 只確認使用者登入狀態、帳號存在且未被停用 / 吊銷，不做 action / policy 判斷——
// 真正的資源授權還是由 /api/v1/* 的 Verify 把關。
func (h *Handler) VerifyPage(w http.ResponseWriter, r *http.Request) {
	claims, code, err := h.verifyIdentity(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}
	w.Header().Set("X-User-Id", strconv.Itoa(claims.UserID))
	w.Header().Set("X-User-Role", claims.Role)
	w.Header().Set("X-Tenant-Id", strconv.Itoa(claims.TenantID))
	w.WriteHeader(http.StatusOK)
}
