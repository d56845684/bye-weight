package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

var tenantSlugRe = regexp.MustCompile(`^[a-z][a-z0-9-]{1,49}$`)

// 新 tenant 建立時預設訂閱的服務與角色（不含 admin / super_admin；這些是系統級）
// 新 tenant 預設訂的 services。admin 加進去，讓該 tenant 的 clinic-admin
// 能進 /admin/* 後台。super-admin 的政策本來就含 *:* 不受影響。
var defaultTenantServices = []string{"auth", "main", "frontend", "admin"}
var defaultTenantRoles = []string{"patient", "staff", "nutritionist", "admin"}

type tenantRow struct {
	ID            int    `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	Active        bool   `json:"active"`
	ServiceCount  int    `json:"service_count"`
	RoleCount     int    `json:"role_count"`
	UserCount     int    `json:"user_count"`
	Locked        bool   `json:"locked"` // system tenant 不可編
}

// ListTenants：GET /auth/admin/tenants
func (h *Handler) ListTenants(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(), `
		SELECT t.id, t.slug, t.name, t.active,
			COALESCE((SELECT COUNT(*) FROM tenant_services WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM tenant_roles    WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM users           WHERE tenant_id = t.id), 0)
		FROM tenants t
		ORDER BY t.id`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tenants := []tenantRow{}
	for rows.Next() {
		var t tenantRow
		if err := rows.Scan(&t.ID, &t.Slug, &t.Name, &t.Active,
			&t.ServiceCount, &t.RoleCount, &t.UserCount); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		t.Locked = t.ID == 0
		tenants = append(tenants, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tenants": tenants})
}

// GetTenant：GET /auth/admin/tenants/{id}
func (h *Handler) GetTenant(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var t tenantRow
	err = h.engine.DB().QueryRow(r.Context(), `
		SELECT t.id, t.slug, t.name, t.active,
			COALESCE((SELECT COUNT(*) FROM tenant_services WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM tenant_roles    WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM users           WHERE tenant_id = t.id), 0)
		FROM tenants t WHERE t.id = $1`, id).Scan(
		&t.ID, &t.Slug, &t.Name, &t.Active,
		&t.ServiceCount, &t.RoleCount, &t.UserCount,
	)
	if err == pgx.ErrNoRows {
		http.Error(w, "tenant not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	t.Locked = t.ID == 0
	writeJSON(w, http.StatusOK, t)
}

type createTenantRequest struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// CreateTenant：POST /auth/admin/tenants
// 新 tenant 的 id 從 1 起（避開 0 系統 tenant）；建立後自動 seed 預設訂閱。
func (h *Handler) CreateTenant(w http.ResponseWriter, r *http.Request) {
	var req createTenantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	req.Slug = strings.TrimSpace(req.Slug)
	req.Name = strings.TrimSpace(req.Name)
	if !tenantSlugRe.MatchString(req.Slug) {
		http.Error(w, "slug must match ^[a-z][a-z0-9-]{1,49}$", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	tx, err := h.engine.DB().Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())
	if err := applyAuditContext(r.Context(), tx, r); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var id int
	err = tx.QueryRow(r.Context(), `
		INSERT INTO tenants (id, slug, name, active)
		VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM tenants WHERE id > 0), $1, $2, true)
		RETURNING id`, req.Slug, req.Name).Scan(&id)
	if err != nil {
		http.Error(w, "create failed: "+err.Error(), http.StatusConflict)
		return
	}

	// 預設訂閱：main / auth / frontend services，非 super_admin 的四個角色
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO tenant_services (tenant_id, service_id)
		SELECT $1, s.id FROM services s WHERE s.name = ANY($2)
		ON CONFLICT DO NOTHING`, id, defaultTenantServices); err != nil {
		http.Error(w, "seed services failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO tenant_roles (tenant_id, role_id)
		SELECT $1, r.id FROM roles r WHERE r.name = ANY($2)
		ON CONFLICT DO NOTHING`, id, defaultTenantRoles); err != nil {
		http.Error(w, "seed roles failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = h.engine.Invalidate(r.Context())

	writeJSON(w, http.StatusCreated, tenantRow{
		ID: id, Slug: req.Slug, Name: req.Name, Active: true,
		ServiceCount: len(defaultTenantServices),
		RoleCount:    len(defaultTenantRoles),
	})
}

type updateTenantRequest struct {
	Name   *string `json:"name,omitempty"`
	Active *bool   `json:"active,omitempty"`
}

// UpdateTenant：PATCH /auth/admin/tenants/{id}
func (h *Handler) UpdateTenant(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if id == 0 {
		http.Error(w, "system tenant is read-only", http.StatusLocked)
		return
	}
	var req updateTenantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	err = withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
		if req.Name != nil {
			name := strings.TrimSpace(*req.Name)
			if name == "" {
				return fmt.Errorf("name cannot be empty")
			}
			if _, err := tx.Exec(r.Context(),
				`UPDATE tenants SET name = $1 WHERE id = $2`, name, id); err != nil {
				return err
			}
		}
		if req.Active != nil {
			if _, err := tx.Exec(r.Context(),
				`UPDATE tenants SET active = $1 WHERE id = $2`, *req.Active, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "id": id})
}

// DeleteTenant：DELETE /auth/admin/tenants/{id}
// 軟刪：設 active=false；避免 CASCADE 掉 users。真正的硬刪請直接 SQL。
func (h *Handler) DeleteTenant(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if id == 0 {
		http.Error(w, "system tenant cannot be deleted", http.StatusLocked)
		return
	}
	res, err := h.engine.DB().Exec(r.Context(),
		`UPDATE tenants SET active = false WHERE id = $1`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "tenant not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deactivated", "id": id})
}

// ── tenant_services subscription ────────────────────────────────

// GetTenantServices：GET /auth/admin/tenants/{id}/services
// 回傳「此 tenant 訂閱的 service_id 清單」。
func (h *Handler) GetTenantServices(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT service_id FROM tenant_services WHERE tenant_id = $1`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var sid int
		if err := rows.Scan(&sid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ids = append(ids, sid)
	}
	writeJSON(w, http.StatusOK, map[string]any{"service_ids": ids})
}

type setIDsRequest struct {
	ServiceIDs []int `json:"service_ids,omitempty"`
	RoleIDs    []int `json:"role_ids,omitempty"`
}

// SetTenantServices：PUT /auth/admin/tenants/{id}/services
// 覆寫式：刪除既有、依 request 重建。
func (h *Handler) SetTenantServices(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if id == 0 {
		http.Error(w, "system tenant subscriptions are locked", http.StatusLocked)
		return
	}
	var req setIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	tx, err := h.engine.DB().Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())
	if err := applyAuditContext(r.Context(), tx, r); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(r.Context(),
		`DELETE FROM tenant_services WHERE tenant_id = $1`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, sid := range req.ServiceIDs {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO tenant_services (tenant_id, service_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, id, sid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = h.engine.Invalidate(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.ServiceIDs)})
}

// ── tenant_roles subscription ─────────────────────────────────────

// GetTenantRoles：GET /auth/admin/tenants/{id}/roles
func (h *Handler) GetTenantRoles(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	rows, err := h.engine.DB().Query(r.Context(),
		`SELECT role_id FROM tenant_roles WHERE tenant_id = $1`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var rid int
		if err := rows.Scan(&rid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ids = append(ids, rid)
	}
	writeJSON(w, http.StatusOK, map[string]any{"role_ids": ids})
}

// SetTenantRoles：PUT /auth/admin/tenants/{id}/roles
func (h *Handler) SetTenantRoles(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if id == 0 {
		http.Error(w, "system tenant subscriptions are locked", http.StatusLocked)
		return
	}
	var req setIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	tx, err := h.engine.DB().Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())
	if err := applyAuditContext(r.Context(), tx, r); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(r.Context(),
		`DELETE FROM tenant_roles WHERE tenant_id = $1`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, rid := range req.RoleIDs {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO tenant_roles (tenant_id, role_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, id, rid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.RoleIDs)})
}
