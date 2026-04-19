package handler

import (
	"encoding/json"
	"net/http"
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
