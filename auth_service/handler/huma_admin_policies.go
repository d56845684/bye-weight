package handler

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

// Batch 4b：/auth/admin/policies 系全改 huma。3 個 endpoint：
//   ListPolicies / GetPolicy / UpdatePolicy
// canReadPolicy / canWritePolicy 用 huma Input 直接傳 role + tenantID，不再靠 *http.Request。

// canReadPolicyFor：super_admin 看全；非 super 只能看自家 tenant + 系統 (tenant_id=0)。
func canReadPolicyFor(actingTenantID int, actingRole string, policyTenantID int) bool {
	if actingRole == "super_admin" {
		return true
	}
	return policyTenantID == actingTenantID || policyTenantID == 0
}

// canWritePolicyFor：比 read 嚴格 —— 系統 policy (tenant_id=0) 只有 super_admin 能改。
func canWritePolicyFor(actingTenantID int, actingRole string, policyTenantID int) bool {
	if actingRole == "super_admin" {
		return true
	}
	if policyTenantID == 0 {
		return false
	}
	return policyTenantID == actingTenantID
}

// ===== ListPolicies：GET /auth/admin/policies =====

type ListPoliciesInput struct {
	XUserRole string `header:"X-User-Role"`
	XTenantID int    `header:"X-Tenant-Id"`
}

type ListPoliciesOutput struct {
	Body struct {
		Policies []policyRow `json:"policies"`
	}
}

func (h *Handler) HumaListPolicies(ctx context.Context, in *ListPoliciesInput) (*ListPoliciesOutput, error) {
	var rows pgx.Rows
	var err error
	if in.XUserRole == "super_admin" {
		rows, err = h.engine.DB().Query(ctx,
			`SELECT id, name, tenant_id, document FROM policies ORDER BY name`)
	} else {
		rows, err = h.engine.DB().Query(ctx,
			`SELECT id, name, tenant_id, document FROM policies
			 WHERE tenant_id IN ($1, 0) ORDER BY name`, in.XTenantID)
	}
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()

	policies := []policyRow{}
	for rows.Next() {
		var p policyRow
		var docBytes []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.TenantID, &docBytes); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		p.Document = json.RawMessage(docBytes)
		policies = append(policies, p)
	}
	out := &ListPoliciesOutput{}
	out.Body.Policies = policies
	return out, nil
}

// ===== GetPolicy：GET /auth/admin/policies/{id} =====

type GetPolicyInput struct {
	XUserRole string `header:"X-User-Role"`
	XTenantID int    `header:"X-Tenant-Id"`
	ID        int    `path:"id"`
}

type GetPolicyOutput struct {
	Body policyDetail
}

func (h *Handler) HumaGetPolicy(ctx context.Context, in *GetPolicyInput) (*GetPolicyOutput, error) {
	var p policyDetail
	var docBytes []byte
	err := h.engine.DB().QueryRow(ctx,
		`SELECT id, name, tenant_id, document FROM policies WHERE id = $1`, in.ID).
		Scan(&p.ID, &p.Name, &p.TenantID, &docBytes)
	if err == pgx.ErrNoRows {
		return nil, huma.Error404NotFound("policy not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if !canReadPolicyFor(in.XTenantID, in.XUserRole, p.TenantID) {
		return nil, huma.Error404NotFound("policy not found")
	}
	p.Document = json.RawMessage(docBytes)

	rows, err := h.engine.DB().Query(ctx, `
		SELECT r.name FROM role_policies rp
		JOIN roles r ON rp.role_id = r.id
		WHERE rp.policy_id = $1
		ORDER BY r.name`, in.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
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

	out := &GetPolicyOutput{Body: p}
	return out, nil
}

// ===== UpdatePolicy：PATCH /auth/admin/policies/{id} =====

type UpdatePolicyInput struct {
	XUserID   int    `header:"X-User-Id"`
	XUserRole string `header:"X-User-Role"`
	XTenantID int    `header:"X-Tenant-Id"`
	ID        int    `path:"id"`
	Body      struct {
		Document json.RawMessage `json:"document"`
	}
}

type UpdatePolicyOutput struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
	}
}

func (h *Handler) HumaUpdatePolicy(ctx context.Context, in *UpdatePolicyInput) (*UpdatePolicyOutput, error) {
	var policyTenant int
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT tenant_id FROM policies WHERE id = $1`, in.ID).Scan(&policyTenant); err != nil {
		if err == pgx.ErrNoRows {
			return nil, huma.Error404NotFound("policy not found")
		}
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if !canWritePolicyFor(in.XTenantID, in.XUserRole, policyTenant) {
		return nil, huma.Error403Forbidden("cannot modify policies outside your tenant")
	}

	if len(in.Body.Document) == 0 {
		return nil, huma.Error400BadRequest("document required")
	}
	var shape struct {
		Statements []map[string]any `json:"statements"`
	}
	if err := json.Unmarshal(in.Body.Document, &shape); err != nil {
		return nil, huma.Error400BadRequest("document is not valid JSON: " + err.Error())
	}
	if len(shape.Statements) == 0 {
		return nil, huma.Error400BadRequest("document.statements must be a non-empty array")
	}
	for i, stmt := range shape.Statements {
		if stmt["effect"] == nil {
			return nil, huma.Error400BadRequest("statement[" + strconv.Itoa(i) + "] missing 'effect'")
		}
	}

	var affected int64
	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		res, err := tx.Exec(ctx,
			`UPDATE policies SET document = $1 WHERE id = $2`, string(in.Body.Document), in.ID)
		if err != nil {
			return err
		}
		affected = res.RowsAffected()
		return nil
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("update failed: " + err.Error())
	}
	if affected == 0 {
		return nil, huma.Error404NotFound("policy not found")
	}
	_ = h.engine.Invalidate(ctx)

	out := &UpdatePolicyOutput{}
	out.Body.Status = "updated"
	out.Body.ID = in.ID
	return out, nil
}
