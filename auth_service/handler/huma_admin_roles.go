package handler

import (
	"context"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

// Batch 4a：/auth/admin/roles 系全改 huma。5 個 endpoint：
//   ListRoles / CreateRole / DeleteRole / GetRolePolicies / SetRolePolicies
// 共用型別（roleRow / policyRow / lockedFrom*）仍在 admin_roles.go。

// ===== ListRoles：GET /auth/admin/roles =====

type ListRolesInput struct{}

type ListRolesOutput struct {
	Body struct {
		Roles []roleRow `json:"roles"`
	}
}

func (h *Handler) HumaListRoles(ctx context.Context, _ *ListRolesInput) (*ListRolesOutput, error) {
	rows, err := h.engine.DB().Query(ctx, `
		SELECT r.id, r.name,
			COALESCE((SELECT COUNT(*) FROM users         WHERE role_id = r.id), 0),
			COALESCE((SELECT COUNT(*) FROM role_policies WHERE role_id = r.id), 0)
		FROM roles r
		ORDER BY r.id`)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()

	roles := []roleRow{}
	for rows.Next() {
		var rr roleRow
		if err := rows.Scan(&rr.ID, &rr.Name, &rr.UserCount, &rr.PolicyCount); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		rr.Locked = lockedFromDelete[rr.Name]
		roles = append(roles, rr)
	}
	out := &ListRolesOutput{}
	out.Body.Roles = roles
	return out, nil
}

// ===== CreateRole：POST /auth/admin/roles =====

type CreateRoleInput struct {
	Body struct {
		Name string `json:"name"`
	}
}

type CreateRoleOutput struct {
	Status int
	Body   struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}
}

func (h *Handler) HumaCreateRole(ctx context.Context, in *CreateRoleInput) (*CreateRoleOutput, error) {
	name := strings.TrimSpace(in.Body.Name)
	if !roleNameRe.MatchString(name) {
		return nil, huma.Error400BadRequest("role name must match ^[a-z][a-z0-9_]{1,49}$")
	}
	var id int
	if err := h.engine.DB().QueryRow(ctx,
		`INSERT INTO roles (name) VALUES ($1) RETURNING id`, name).Scan(&id); err != nil {
		return nil, huma.Error409Conflict("role name conflict: " + err.Error())
	}
	_ = h.engine.Invalidate(ctx)

	out := &CreateRoleOutput{Status: 201}
	out.Body.ID = id
	out.Body.Name = name
	return out, nil
}

// ===== DeleteRole：DELETE /auth/admin/roles/{id} =====

type DeleteRoleInput struct {
	ID int `path:"id"`
}

type DeleteRoleOutput struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
	}
}

func (h *Handler) HumaDeleteRole(ctx context.Context, in *DeleteRoleInput) (*DeleteRoleOutput, error) {
	var name string
	var userCount int
	err := h.engine.DB().QueryRow(ctx, `
		SELECT r.name, COALESCE((SELECT COUNT(*) FROM users WHERE role_id = r.id), 0)
		FROM roles r WHERE r.id = $1`, in.ID).Scan(&name, &userCount)
	if err == pgx.ErrNoRows {
		return nil, huma.Error404NotFound("role not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if lockedFromDelete[name] {
		return nil, huma.NewError(423, "system role cannot be deleted")
	}
	if userCount > 0 {
		return nil, huma.Error422UnprocessableEntity("role has users assigned; reassign them first")
	}
	if _, err := h.engine.DB().Exec(ctx, `DELETE FROM roles WHERE id = $1`, in.ID); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	_ = h.engine.Invalidate(ctx)

	out := &DeleteRoleOutput{}
	out.Body.Status = "deleted"
	out.Body.ID = in.ID
	return out, nil
}

// ===== GetRolePolicies：GET /auth/admin/roles/{id}/policies =====

type GetRolePoliciesInput struct {
	ID int `path:"id"`
}

type GetRolePoliciesOutput struct {
	Body struct {
		PolicyIDs []int `json:"policy_ids"`
	}
}

func (h *Handler) HumaGetRolePolicies(ctx context.Context, in *GetRolePoliciesInput) (*GetRolePoliciesOutput, error) {
	rows, err := h.engine.DB().Query(ctx,
		`SELECT policy_id FROM role_policies WHERE role_id = $1`, in.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()

	ids := []int{}
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		ids = append(ids, pid)
	}
	out := &GetRolePoliciesOutput{}
	out.Body.PolicyIDs = ids
	return out, nil
}

// ===== SetRolePolicies：PUT /auth/admin/roles/{id}/policies =====

type SetRolePoliciesInput struct {
	XUserID   int    `header:"X-User-Id"`
	XUserRole string `header:"X-User-Role"`
	XTenantID int    `header:"X-Tenant-Id"`
	ID        int    `path:"id"`
	Body      struct {
		PolicyIDs []int `json:"policy_ids"`
	}
}

type SetRolePoliciesOutput struct {
	Body struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}
}

func (h *Handler) HumaSetRolePolicies(ctx context.Context, in *SetRolePoliciesInput) (*SetRolePoliciesOutput, error) {
	var name string
	err := h.engine.DB().QueryRow(ctx,
		`SELECT name FROM roles WHERE id = $1`, in.ID).Scan(&name)
	if err == pgx.ErrNoRows {
		return nil, huma.Error404NotFound("role not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if lockedFromPolicyEdit[name] {
		return nil, huma.NewError(423, "system role policies are locked")
	}

	// Tenant scope：非 super_admin 只能綁自家或系統 policy
	if in.XUserRole != "super_admin" && len(in.Body.PolicyIDs) > 0 {
		rows, err := h.engine.DB().Query(ctx,
			`SELECT id, tenant_id FROM policies WHERE id = ANY($1)`, in.Body.PolicyIDs)
		if err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		seen := make(map[int]bool, len(in.Body.PolicyIDs))
		for rows.Next() {
			var pid, tid int
			if err := rows.Scan(&pid, &tid); err != nil {
				rows.Close()
				return nil, huma.Error500InternalServerError(err.Error())
			}
			seen[pid] = true
			if tid != 0 && tid != in.XTenantID {
				rows.Close()
				return nil, huma.Error403Forbidden("policy outside your tenant cannot be bound")
			}
		}
		rows.Close()
		for _, pid := range in.Body.PolicyIDs {
			if !seen[pid] {
				return nil, huma.Error400BadRequest("policy id not found")
			}
		}
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
		`DELETE FROM role_policies WHERE role_id = $1`, in.ID); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	for _, pid := range in.Body.PolicyIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO role_policies (role_id, policy_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, in.ID, pid); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	_ = h.engine.Invalidate(ctx)

	out := &SetRolePoliciesOutput{}
	out.Body.Status = "updated"
	out.Body.Count = len(in.Body.PolicyIDs)
	return out, nil
}

// itoaFast：避免引入 strconv 的小整數 → string；0 / 負數照樣能印。
func itoaFast(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
