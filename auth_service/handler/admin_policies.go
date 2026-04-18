package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type policyDetail struct {
	ID        int             `json:"id"`
	Name      string          `json:"name"`
	Document  json.RawMessage `json:"document"`
	RoleNames []string        `json:"role_names"`
}

// GetPolicy：GET /auth/v1/admin/policies/{id}
// 回傳單一 policy 完整文件 + 使用此 policy 的 role 名稱清單。
func (h *Handler) GetPolicy(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var p policyDetail
	var docBytes []byte
	err = h.engine.DB().QueryRow(r.Context(),
		`SELECT id, name, document FROM policies WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &docBytes)
	if err == pgx.ErrNoRows {
		http.Error(w, "policy not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p.Document = json.RawMessage(docBytes)

	rows, err := h.engine.DB().Query(r.Context(), `
		SELECT r.name FROM role_policies rp
		JOIN roles r ON rp.role_id = r.id
		WHERE rp.policy_id = $1
		ORDER BY r.name`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err == nil {
			p.RoleNames = append(p.RoleNames, n)
		}
	}
	if p.RoleNames == nil {
		p.RoleNames = []string{}
	}

	writeJSON(w, http.StatusOK, p)
}

type updatePolicyRequest struct {
	Document json.RawMessage `json:"document"`
}

// UpdatePolicy：PATCH /auth/v1/admin/policies/{id}
// 目前僅允許改 document（name 做歷史錨點，不開放改）。
// 後端驗證 JSON 結構；validation 失敗直接 400。
func (h *Handler) UpdatePolicy(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var req updatePolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if len(req.Document) == 0 {
		http.Error(w, "document required", http.StatusBadRequest)
		return
	}

	// 快速驗證：document 必須解析成 { statements: [...] }
	var shape struct {
		Statements []map[string]any `json:"statements"`
	}
	if err := json.Unmarshal(req.Document, &shape); err != nil {
		http.Error(w, "document is not valid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(shape.Statements) == 0 {
		http.Error(w, "document.statements must be a non-empty array", http.StatusBadRequest)
		return
	}
	for i, stmt := range shape.Statements {
		if stmt["effect"] == nil {
			http.Error(w, "statement["+strconv.Itoa(i)+"] missing 'effect'", http.StatusBadRequest)
			return
		}
	}

	res, err := h.engine.DB().Exec(r.Context(),
		`UPDATE policies SET document = $1 WHERE id = $2`, string(req.Document), id)
	if err != nil {
		http.Error(w, "update failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "policy not found", http.StatusNotFound)
		return
	}

	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "id": id})
}
