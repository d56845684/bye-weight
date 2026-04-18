package handler

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// 系統保護的角色：不可刪除；super_admin 還不可改 policy 綁定
var lockedFromDelete = map[string]bool{
	"super_admin": true,
	"patient":     true,
}
var lockedFromPolicyEdit = map[string]bool{
	"super_admin": true,
}

var roleNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)

type roleRow struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	UserCount   int    `json:"user_count"`
	PolicyCount int    `json:"policy_count"`
	Locked      bool   `json:"locked"`
}

// ListRoles：GET /auth/admin/roles
func (h *Handler) ListRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(), `
		SELECT r.id, r.name,
			COALESCE((SELECT COUNT(*) FROM users         WHERE role_id = r.id), 0),
			COALESCE((SELECT COUNT(*) FROM role_policies WHERE role_id = r.id), 0)
		FROM roles r
		ORDER BY r.id`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	roles := []roleRow{}
	for rows.Next() {
		var rr roleRow
		if err := rows.Scan(&rr.ID, &rr.Name, &rr.UserCount, &rr.PolicyCount); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		rr.Locked = lockedFromDelete[rr.Name]
		roles = append(roles, rr)
	}

	writeJSON(w, http.StatusOK, map[string]any{"roles": roles})
}

type createRoleRequest struct {
	Name string `json:"name"`
}

// CreateRole：POST /auth/admin/roles
func (h *Handler) CreateRole(w http.ResponseWriter, r *http.Request) {
	var req createRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if !roleNameRe.MatchString(req.Name) {
		http.Error(w, "role name must match ^[a-z][a-z0-9_]{1,49}$", http.StatusBadRequest)
		return
	}

	var id int
	err := h.engine.DB().QueryRow(r.Context(),
		`INSERT INTO roles (name) VALUES ($1) RETURNING id`, req.Name).Scan(&id)
	if err != nil {
		http.Error(w, "role name conflict: "+err.Error(), http.StatusConflict)
		return
	}

	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "name": req.Name})
}

// DeleteRole：DELETE /auth/admin/roles/{id}
func (h *Handler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name string
	var userCount int
	err = h.engine.DB().QueryRow(r.Context(), `
		SELECT r.name, COALESCE((SELECT COUNT(*) FROM users WHERE role_id = r.id), 0)
		FROM roles r WHERE r.id = $1`, id).Scan(&name, &userCount)
	if err == pgx.ErrNoRows {
		http.Error(w, "role not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if lockedFromDelete[name] {
		http.Error(w, "system role cannot be deleted", http.StatusLocked)
		return
	}
	if userCount > 0 {
		http.Error(w, "role has users assigned; reassign them first", http.StatusUnprocessableEntity)
		return
	}

	// role_policies 透過 FK ON DELETE CASCADE 自動清除
	if _, err := h.engine.DB().Exec(r.Context(), `DELETE FROM roles WHERE id = $1`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id})
}

type policyRow struct {
	ID       int             `json:"id"`
	Name     string          `json:"name"`
	Document json.RawMessage `json:"document"`
}

// ListPolicies：GET /auth/admin/policies
func (h *Handler) ListPolicies(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT id, name, document FROM policies ORDER BY name`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	policies := []policyRow{}
	for rows.Next() {
		var p policyRow
		var docBytes []byte
		if err := rows.Scan(&p.ID, &p.Name, &docBytes); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		p.Document = json.RawMessage(docBytes)
		policies = append(policies, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"policies": policies})
}

// GetRolePolicies：GET /auth/admin/roles/{id}/policies
func (h *Handler) GetRolePolicies(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT policy_id FROM role_policies WHERE role_id = $1`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	ids := []int{}
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ids = append(ids, pid)
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy_ids": ids})
}

type setRolePoliciesRequest struct {
	PolicyIDs []int `json:"policy_ids"`
}

// SetRolePolicies：PUT /auth/admin/roles/{id}/policies
// 完整覆蓋：清空既有 → 依 request 重建
func (h *Handler) SetRolePolicies(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req setRolePoliciesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	var name string
	err = h.engine.DB().QueryRow(r.Context(),
		`SELECT name FROM roles WHERE id = $1`, id).Scan(&name)
	if err == pgx.ErrNoRows {
		http.Error(w, "role not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if lockedFromPolicyEdit[name] {
		http.Error(w, "system role policies are locked", http.StatusLocked)
		return
	}

	tx, err := h.engine.DB().Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(),
		`DELETE FROM role_policies WHERE role_id = $1`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, pid := range req.PolicyIDs {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO role_policies (role_id, policy_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, id, pid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.PolicyIDs)})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
