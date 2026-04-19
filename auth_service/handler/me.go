package handler

import (
	"encoding/json"
	"net/http"
	"auth_service/engine"
)

// Me：給前端用，取得當前登入者 identity。共用 verifyIdentity，涵蓋 cookie/JWT/
// blacklist/user.active/tenant.active/user revoke 全部檢查。
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	claims, code, err := h.verifyIdentity(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":   claims.UserID,
		"role":      claims.Role,
		"tenant_id": claims.TenantID,
	})
}

// MePermissions：GET /auth/me/permissions — 回當前 user 被允許的所有 action pattern（flat）。
// 前端 <Can action="..."> 用來決定 nav / 按鈕顯示。
// 讀 engine in-memory 快取，不打 DB；verifyIdentity 本身有 2 筆 PK 查詢，整體 <2ms。
func (h *Handler) MePermissions(w http.ResponseWriter, r *http.Request) {
	claims, code, err := h.verifyIdentity(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}
	actions := h.engine.ResolveActionsForSubject(engine.Subject{
		UserID:   claims.UserID,
		Role:     claims.Role,
		TenantID: claims.TenantID,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"role":      claims.Role,
		"tenant_id": claims.TenantID,
		"actions":   actions,
	})
}
