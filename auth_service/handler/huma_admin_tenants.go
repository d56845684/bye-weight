package handler

import (
	"context"
	"fmt"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

// Batch 5a：/auth/admin/tenants 系全改 huma。9 個 endpoint：
//   List / Get / Create / Update / Delete + GetServices / SetServices +
//   GetRoles / SetRoles。共用型別（tenantRow / setIDsRequest 等）仍在
//   admin_tenants.go。

// ===== ListTenants：GET /auth/admin/tenants =====

type ListTenantsInput struct{}

type ListTenantsOutput struct {
	Body struct {
		Tenants []tenantRow `json:"tenants"`
	}
}

func (h *Handler) HumaListTenants(ctx context.Context, _ *ListTenantsInput) (*ListTenantsOutput, error) {
	rows, err := h.engine.DB().Query(ctx, `
		SELECT t.id, t.slug, t.name, t.active,
			COALESCE((SELECT COUNT(*) FROM tenant_services WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM tenant_roles    WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM users           WHERE tenant_id = t.id), 0)
		FROM tenants t
		ORDER BY t.id`)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()

	tenants := []tenantRow{}
	for rows.Next() {
		var t tenantRow
		if err := rows.Scan(&t.ID, &t.Slug, &t.Name, &t.Active,
			&t.ServiceCount, &t.RoleCount, &t.UserCount); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		t.Locked = t.ID == 0
		tenants = append(tenants, t)
	}
	out := &ListTenantsOutput{}
	out.Body.Tenants = tenants
	return out, nil
}

// ===== GetTenant：GET /auth/admin/tenants/{id} =====

type GetTenantInput struct {
	ID int `path:"id"`
}

type GetTenantOutput struct {
	Body tenantRow
}

func (h *Handler) HumaGetTenant(ctx context.Context, in *GetTenantInput) (*GetTenantOutput, error) {
	var t tenantRow
	err := h.engine.DB().QueryRow(ctx, `
		SELECT t.id, t.slug, t.name, t.active,
			COALESCE((SELECT COUNT(*) FROM tenant_services WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM tenant_roles    WHERE tenant_id = t.id), 0),
			COALESCE((SELECT COUNT(*) FROM users           WHERE tenant_id = t.id), 0)
		FROM tenants t WHERE t.id = $1`, in.ID).Scan(
		&t.ID, &t.Slug, &t.Name, &t.Active,
		&t.ServiceCount, &t.RoleCount, &t.UserCount,
	)
	if err == pgx.ErrNoRows {
		return nil, huma.Error404NotFound("tenant not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	t.Locked = t.ID == 0
	return &GetTenantOutput{Body: t}, nil
}

// ===== CreateTenant：POST /auth/admin/tenants =====

type CreateTenantInput struct {
	XUserID int `header:"X-User-Id"`
	Body    struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	}
}

type CreateTenantOutput struct {
	Status int
	Body   tenantRow
}

func (h *Handler) HumaCreateTenant(ctx context.Context, in *CreateTenantInput) (*CreateTenantOutput, error) {
	slug := strings.TrimSpace(in.Body.Slug)
	name := strings.TrimSpace(in.Body.Name)
	if !tenantSlugRe.MatchString(slug) {
		return nil, huma.Error400BadRequest("slug must match ^[a-z][a-z0-9-]{1,49}$")
	}
	if name == "" {
		return nil, huma.Error400BadRequest("name required")
	}

	tx, err := h.engine.DB().Begin(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer tx.Rollback(ctx)
	if in.XUserID > 0 {
		if _, err := tx.Exec(ctx,
			"SELECT set_config('app.current_user', $1, true)", itoaFast(in.XUserID)); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}

	var id int
	err = tx.QueryRow(ctx, `
		INSERT INTO tenants (id, slug, name, active)
		VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM tenants WHERE id > 0), $1, $2, true)
		RETURNING id`, slug, name).Scan(&id)
	if err != nil {
		return nil, huma.Error409Conflict("create failed: " + err.Error())
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO tenant_services (tenant_id, service_id)
		SELECT $1, s.id FROM services s WHERE s.name = ANY($2)
		ON CONFLICT DO NOTHING`, id, defaultTenantServices); err != nil {
		return nil, huma.Error500InternalServerError("seed services failed: " + err.Error())
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tenant_roles (tenant_id, role_id)
		SELECT $1, r.id FROM roles r WHERE r.name = ANY($2)
		ON CONFLICT DO NOTHING`, id, defaultTenantRoles); err != nil {
		return nil, huma.Error500InternalServerError("seed roles failed: " + err.Error())
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	_ = h.engine.Invalidate(ctx)

	out := &CreateTenantOutput{Status: 201}
	out.Body = tenantRow{
		ID: id, Slug: slug, Name: name, Active: true,
		ServiceCount: len(defaultTenantServices),
		RoleCount:    len(defaultTenantRoles),
	}
	return out, nil
}

// ===== UpdateTenant：PATCH /auth/admin/tenants/{id} =====

type UpdateTenantInput struct {
	XUserID int `header:"X-User-Id"`
	ID      int `path:"id"`
	Body    struct {
		Name   *string `json:"name,omitempty"`
		Active *bool   `json:"active,omitempty"`
	}
}

type simpleStatusOut struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
	}
}

func (h *Handler) HumaUpdateTenant(ctx context.Context, in *UpdateTenantInput) (*simpleStatusOut, error) {
	if in.ID == 0 {
		return nil, huma.NewError(423, "system tenant is read-only")
	}
	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		if in.Body.Name != nil {
			n := strings.TrimSpace(*in.Body.Name)
			if n == "" {
				return fmt.Errorf("name cannot be empty")
			}
			if _, err := tx.Exec(ctx,
				`UPDATE tenants SET name = $1 WHERE id = $2`, n, in.ID); err != nil {
				return err
			}
		}
		if in.Body.Active != nil {
			if _, err := tx.Exec(ctx,
				`UPDATE tenants SET active = $1 WHERE id = $2`, *in.Body.Active, in.ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	out := &simpleStatusOut{}
	out.Body.Status = "updated"
	out.Body.ID = in.ID
	return out, nil
}

// ===== DeleteTenant：DELETE /auth/admin/tenants/{id} =====

type DeleteTenantInput struct {
	ID int `path:"id"`
}

func (h *Handler) HumaDeleteTenant(ctx context.Context, in *DeleteTenantInput) (*simpleStatusOut, error) {
	if in.ID == 0 {
		return nil, huma.NewError(423, "system tenant cannot be deleted")
	}
	res, err := h.engine.DB().Exec(ctx,
		`UPDATE tenants SET active = false WHERE id = $1`, in.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if res.RowsAffected() == 0 {
		return nil, huma.Error404NotFound("tenant not found")
	}
	out := &simpleStatusOut{}
	out.Body.Status = "deactivated"
	out.Body.ID = in.ID
	return out, nil
}

// ===== GetTenantServices / SetTenantServices =====

type GetTenantServicesInput struct {
	ID int `path:"id"`
}

type GetTenantServicesOutput struct {
	Body struct {
		ServiceIDs []int `json:"service_ids"`
	}
}

func (h *Handler) HumaGetTenantServices(ctx context.Context, in *GetTenantServicesInput) (*GetTenantServicesOutput, error) {
	rows, err := h.engine.DB().Query(ctx,
		`SELECT service_id FROM tenant_services WHERE tenant_id = $1`, in.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var sid int
		if err := rows.Scan(&sid); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		ids = append(ids, sid)
	}
	out := &GetTenantServicesOutput{}
	out.Body.ServiceIDs = ids
	return out, nil
}

type SetTenantServicesInput struct {
	XUserID int `header:"X-User-Id"`
	ID      int `path:"id"`
	Body    struct {
		ServiceIDs []int `json:"service_ids"`
	}
}

type setCountOut struct {
	Body struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}
}

func (h *Handler) HumaSetTenantServices(ctx context.Context, in *SetTenantServicesInput) (*setCountOut, error) {
	if in.ID == 0 {
		return nil, huma.NewError(423, "system tenant subscriptions are locked")
	}
	tx, err := h.engine.DB().Begin(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer tx.Rollback(ctx)
	if in.XUserID > 0 {
		if _, err := tx.Exec(ctx,
			"SELECT set_config('app.current_user', $1, true)", itoaFast(in.XUserID)); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM tenant_services WHERE tenant_id = $1`, in.ID); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	for _, sid := range in.Body.ServiceIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO tenant_services (tenant_id, service_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, in.ID, sid); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	_ = h.engine.Invalidate(ctx)

	out := &setCountOut{}
	out.Body.Status = "updated"
	out.Body.Count = len(in.Body.ServiceIDs)
	return out, nil
}

// ===== GetTenantRoles / SetTenantRoles =====

type GetTenantRolesInput struct {
	ID int `path:"id"`
}

type GetTenantRolesOutput struct {
	Body struct {
		RoleIDs []int `json:"role_ids"`
	}
}

func (h *Handler) HumaGetTenantRoles(ctx context.Context, in *GetTenantRolesInput) (*GetTenantRolesOutput, error) {
	rows, err := h.engine.DB().Query(ctx,
		`SELECT role_id FROM tenant_roles WHERE tenant_id = $1`, in.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var rid int
		if err := rows.Scan(&rid); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		ids = append(ids, rid)
	}
	out := &GetTenantRolesOutput{}
	out.Body.RoleIDs = ids
	return out, nil
}

type SetTenantRolesInput struct {
	XUserID int `header:"X-User-Id"`
	ID      int `path:"id"`
	Body    struct {
		RoleIDs []int `json:"role_ids"`
	}
}

func (h *Handler) HumaSetTenantRoles(ctx context.Context, in *SetTenantRolesInput) (*setCountOut, error) {
	if in.ID == 0 {
		return nil, huma.NewError(423, "system tenant subscriptions are locked")
	}
	tx, err := h.engine.DB().Begin(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer tx.Rollback(ctx)
	if in.XUserID > 0 {
		if _, err := tx.Exec(ctx,
			"SELECT set_config('app.current_user', $1, true)", itoaFast(in.XUserID)); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM tenant_roles WHERE tenant_id = $1`, in.ID); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	for _, rid := range in.Body.RoleIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO tenant_roles (tenant_id, role_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, in.ID, rid); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	out := &setCountOut{}
	out.Body.Status = "updated"
	out.Body.Count = len(in.Body.RoleIDs)
	return out, nil
}
