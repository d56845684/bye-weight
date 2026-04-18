package handler

import (
	"net/http"
	"strconv"

	"auth_service/engine"
	"auth_service/token"
)

// Verify 對應 Nginx auth_request。流程：
// 1. 解 access_token cookie
// 2. 查 blacklist（fail-closed）
// 3. 從 action_mappings 解析原始請求 → (action, resource template, path 變數)
// 4. 展開 resource template 取得具體 ARN
// 5. 依 subject.role 對應的 policies 做 IAM 評估
// 6. 通過後注入 X-User-Id / X-User-Role / X-Tenant-Id header
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
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

	// fail-closed：Redis 故障時拒絕
	revoked, err := token.IsRevoked(r.Context(), h.rdb, claims.ID)
	if err != nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	if revoked {
		http.Error(w, "token revoked", http.StatusUnauthorized)
		return
	}

	// 確認使用者仍啟用（後台將 active=false 後應立即生效，不等 JWT 過期）
	var active bool
	err = h.engine.DB().QueryRow(r.Context(),
		`SELECT active FROM users WHERE id = $1`, claims.UserID).Scan(&active)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}
	if !active {
		http.Error(w, "account disabled", http.StatusUnauthorized)
		return
	}

	// 使用者層級吊銷：admin 拔 LINE 綁定 / 改角色 / 切 tenant 時會寫 Redis。
	// JWT 簽發時間早於吊銷時間就視為失效，不必等 JWT TTL 到期。
	if claims.IssuedAt != nil {
		if userRevoked, err := token.IsUserRevoked(r.Context(), h.rdb, claims.UserID, claims.IssuedAt.Time); err != nil {
			http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			return
		} else if userRevoked {
			http.Error(w, "session revoked by admin", http.StatusUnauthorized)
			return
		}
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
