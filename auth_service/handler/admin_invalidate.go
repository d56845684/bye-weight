package handler

import "net/http"

// InvalidateCache：POST /auth/v1/admin/invalidate
// 手動強制重載 engine 的 in-memory cache（action_mappings / role_policies / tenant_services）。
// 平常 engine 每 5 分鐘會自動 refresh；改完 DB 不想等就呼叫這個端點。
func (h *Handler) InvalidateCache(w http.ResponseWriter, r *http.Request) {
	if err := h.engine.Invalidate(r.Context()); err != nil {
		http.Error(w, "invalidate failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "invalidated"})
}
