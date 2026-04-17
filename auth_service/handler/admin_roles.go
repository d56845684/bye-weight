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

// 系統保護的角色：不可刪除；super_admin 還不可改權限
var lockedFromDelete = map[string]bool{
	"super_admin": true,
	"patient":     true,
}
var lockedFromPermissionEdit = map[string]bool{
	"super_admin": true,
}

var roleNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)

type roleRow struct {
	ID              int    `json:"id"`
	Name            string `json:"name"`
	UserCount       int    `json:"user_count"`
	PermissionCount int    `json:"permission_count"`
	Locked          bool   `json:"locked"` // 是否為系統角色（不可刪除）
}

// ListRoles：GET /auth/admin/roles
func (h *Handler) ListRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(), `
		SELECT r.id, r.name,
			COALESCE((SELECT COUNT(*) FROM users           WHERE role_id = r.id), 0),
			COALESCE((SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id), 0)
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
		if err := rows.Scan(&rr.ID, &rr.Name, &rr.UserCount, &rr.PermissionCount); err != nil {
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
		// 假定重複名稱
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

	// role_permissions 透過 FK ON DELETE CASCADE 自動清除
	if _, err := h.engine.DB().Exec(r.Context(), `DELETE FROM roles WHERE id = $1`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id})
}

type permissionRow struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Resource string `json:"resource"`
	Action   string `json:"action"`
}

// ListPermissions：GET /auth/admin/permissions
func (h *Handler) ListPermissions(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT id, name, resource, action FROM permissions ORDER BY resource, action`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	perms := []permissionRow{}
	for rows.Next() {
		var p permissionRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Resource, &p.Action); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		perms = append(perms, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"permissions": perms})
}

// GetRolePermissions：GET /auth/admin/roles/{id}/permissions
func (h *Handler) GetRolePermissions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT permission_id FROM role_permissions WHERE role_id = $1`, id)
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
	writeJSON(w, http.StatusOK, map[string]any{"permission_ids": ids})
}

type setRolePermissionsRequest struct {
	PermissionIDs []int `json:"permission_ids"`
}

// SetRolePermissions：PUT /auth/admin/roles/{id}/permissions
// 完整覆蓋寫入：清空既有 → 依 request 重建
func (h *Handler) SetRolePermissions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req setRolePermissionsRequest
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
	if lockedFromPermissionEdit[name] {
		http.Error(w, "system role permissions are locked", http.StatusLocked)
		return
	}

	tx, err := h.engine.DB().Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(),
		`DELETE FROM role_permissions WHERE role_id = $1`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, pid := range req.PermissionIDs {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
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
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.PermissionIDs)})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
