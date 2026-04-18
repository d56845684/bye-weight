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
