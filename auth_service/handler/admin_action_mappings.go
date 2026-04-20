package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type actionMappingRow struct {
	ID               int    `json:"id"`
	ServiceID        int    `json:"service_id"`
	ServiceName      string `json:"service_name"`
	HTTPMethod       string `json:"http_method"`
	URLPattern       string `json:"url_pattern"`
	Action           string `json:"action"`
	ResourceTemplate string `json:"resource_template"`
}

// ListActionMappings：GET /auth/admin/action-mappings
// 可選 ?service=main 過濾。回傳時按 service 分組、依 url_pattern 排序，前端直接渲染。
func (h *Handler) ListActionMappings(w http.ResponseWriter, r *http.Request) {
	svc := strings.TrimSpace(r.URL.Query().Get("service"))
	query := `
		SELECT am.id, am.service_id, s.name, am.http_method, am.url_pattern,
		       am.action, am.resource_template
		FROM action_mappings am
		JOIN services s ON am.service_id = s.id`
	args := []any{}
	if svc != "" {
		query += ` WHERE s.name = $1`
		args = append(args, svc)
	}
	query += ` ORDER BY s.name, am.url_pattern, am.http_method`

	rows, err := h.engine.DB().Query(r.Context(), query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := []actionMappingRow{}
	for rows.Next() {
		var m actionMappingRow
		if err := rows.Scan(&m.ID, &m.ServiceID, &m.ServiceName,
			&m.HTTPMethod, &m.URLPattern, &m.Action, &m.ResourceTemplate); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		items = append(items, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"mappings": items})
}

type createActionMappingRequest struct {
	ServiceID        int    `json:"service_id"`
	HTTPMethod       string `json:"http_method"`
	URLPattern       string `json:"url_pattern"`
	Action           string `json:"action"`
	ResourceTemplate string `json:"resource_template"`
}

var allowedHTTPMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
}

// CreateActionMapping：POST /auth/admin/action-mappings
func (h *Handler) CreateActionMapping(w http.ResponseWriter, r *http.Request) {
	var req createActionMappingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	req.HTTPMethod = strings.ToUpper(strings.TrimSpace(req.HTTPMethod))
	req.URLPattern = strings.TrimSpace(req.URLPattern)
	req.Action = strings.TrimSpace(req.Action)
	req.ResourceTemplate = strings.TrimSpace(req.ResourceTemplate)

	if req.ServiceID <= 0 {
		http.Error(w, "service_id required", http.StatusBadRequest)
		return
	}
	if !allowedHTTPMethods[req.HTTPMethod] {
		http.Error(w, "http_method must be GET/POST/PUT/PATCH/DELETE", http.StatusBadRequest)
		return
	}
	if req.URLPattern == "" || req.Action == "" || req.ResourceTemplate == "" {
		http.Error(w, "url_pattern, action, resource_template required", http.StatusBadRequest)
		return
	}

	var id int
	err := withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO action_mappings
				(service_id, http_method, url_pattern, action, resource_template)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id`,
			req.ServiceID, req.HTTPMethod, req.URLPattern,
			req.Action, req.ResourceTemplate).Scan(&id)
	})
	if err != nil {
		http.Error(w, "create failed: "+err.Error(), http.StatusConflict)
		return
	}
	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "status": "created"})
}

type updateActionMappingRequest struct {
	HTTPMethod       *string `json:"http_method,omitempty"`
	URLPattern       *string `json:"url_pattern,omitempty"`
	Action           *string `json:"action,omitempty"`
	ResourceTemplate *string `json:"resource_template,omitempty"`
	// service_id 不開放改；要遷移到另一 service 請刪掉重建
}

// UpdateActionMapping：PATCH /auth/admin/action-mappings/{id}
func (h *Handler) UpdateActionMapping(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req updateActionMappingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	// 動態組 UPDATE
	sets := []string{}
	args := []any{}
	i := 1
	add := func(col string, val any) {
		sets = append(sets, col+"=$"+strconv.Itoa(i))
		args = append(args, val)
		i++
	}
	if req.HTTPMethod != nil {
		m := strings.ToUpper(strings.TrimSpace(*req.HTTPMethod))
		if !allowedHTTPMethods[m] {
			http.Error(w, "http_method invalid", http.StatusBadRequest)
			return
		}
		add("http_method", m)
	}
	if req.URLPattern != nil {
		if s := strings.TrimSpace(*req.URLPattern); s != "" {
			add("url_pattern", s)
		}
	}
	if req.Action != nil {
		if s := strings.TrimSpace(*req.Action); s != "" {
			add("action", s)
		}
	}
	if req.ResourceTemplate != nil {
		if s := strings.TrimSpace(*req.ResourceTemplate); s != "" {
			add("resource_template", s)
		}
	}
	if len(sets) == 0 {
		http.Error(w, "no fields to update", http.StatusBadRequest)
		return
	}
	args = append(args, id)
	sql := "UPDATE action_mappings SET " + strings.Join(sets, ", ") +
		" WHERE id=$" + strconv.Itoa(i)

	var affected int64
	err = withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
		res, err := tx.Exec(r.Context(), sql, args...)
		if err != nil {
			return err
		}
		affected = res.RowsAffected()
		return nil
	})
	if err != nil {
		http.Error(w, "update failed: "+err.Error(), http.StatusConflict)
		return
	}
	if affected == 0 {
		http.Error(w, "action_mapping not found", http.StatusNotFound)
		return
	}
	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "id": id})
}

// DeleteActionMapping：DELETE /auth/admin/action-mappings/{id}
// 注意：此 table 沒 soft delete 欄位（system 設定表，非業務 entity），直接硬刪。
func (h *Handler) DeleteActionMapping(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	res, err := h.engine.DB().Exec(r.Context(),
		`DELETE FROM action_mappings WHERE id = $1`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "action_mapping not found", http.StatusNotFound)
		return
	}
	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id})
}
