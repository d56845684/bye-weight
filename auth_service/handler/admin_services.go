package handler

import "net/http"

type serviceRow struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Prefix string `json:"prefix"`
}

// ListServices：GET /auth/admin/services
// 列出所有已註冊的 service（前端 tenant 訂閱 UI 用）。
func (h *Handler) ListServices(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT id, name, prefix FROM services ORDER BY id`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	services := []serviceRow{}
	for rows.Next() {
		var s serviceRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Prefix); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		services = append(services, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": services})
}
