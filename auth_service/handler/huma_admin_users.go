package handler

import (
	"context"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"auth_service/token"
)

// Batch 3：/auth/admin/users 系全改 huma。8 個 endpoint：
//   List / Create / Invite / Update / Delete / RegenerateBindToken / Unbind /
//   SetUserPassword
//
// 每個 Input 都**直接**宣告 `X-User-Id` / `X-User-Role` / `X-Tenant-Id` 三個
// header 欄位（huma v2 的 header tag 不穿透 embedded struct，實測過）。
// 沒共用 struct 多 24 行 boilerplate，但最直白、不會有魔術行為。

// ensureTargetInTenantCtx：非 super_admin 的 caller 必須動自己 tenant 的 user；
// callerTenantID=0 代表 super_admin，一律放行。越界 → 404（故意不洩露存在性）。
func (h *Handler) ensureTargetInTenantCtx(ctx context.Context, callerTenantID, targetUID int) error {
	if callerTenantID == 0 {
		return nil
	}
	var t int
	err := h.engine.DB().QueryRow(ctx,
		`SELECT tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL`, targetUID).Scan(&t)
	if err != nil || t != callerTenantID {
		return huma.Error404NotFound("user not found")
	}
	return nil
}

// ===== ListUsers：GET /auth/admin/users =====

type ListUsersInput struct {
	XUserID   int    `header:"X-User-Id"`
	XUserRole string `header:"X-User-Role"`
	XTenantID int    `header:"X-Tenant-Id"`
}

type ListUsersOutput struct {
	Body struct {
		Users []adminUserRow `json:"users"`
	}
}

func (h *Handler) HumaListUsers(ctx context.Context, in *ListUsersInput) (*ListUsersOutput, error) {
	query := `
		SELECT u.id, u.display_name, u.line_uuid, u.google_email,
		       r.name, u.tenant_id, t.slug, u.active
		FROM users u
		JOIN roles r   ON u.role_id  = r.id
		JOIN tenants t ON u.tenant_id = t.id
		WHERE u.deleted_at IS NULL`
	args := []any{}
	if in.XTenantID != 0 {
		query += ` AND u.tenant_id = $1`
		args = append(args, in.XTenantID)
	}
	query += ` ORDER BY u.id`

	rows, err := h.engine.DB().Query(ctx, query, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("query failed: " + err.Error())
	}
	defer rows.Close()

	users := []adminUserRow{}
	for rows.Next() {
		var u adminUserRow
		if err := rows.Scan(
			&u.ID, &u.DisplayName, &u.LineUUID, &u.GoogleEmail,
			&u.Role, &u.TenantID, &u.TenantSlug, &u.Active,
		); err != nil {
			return nil, huma.Error500InternalServerError("scan failed: " + err.Error())
		}
		methods := []string{}
		if u.LineUUID != nil && *u.LineUUID != "" {
			methods = append(methods, "line")
		}
		if u.GoogleEmail != nil && *u.GoogleEmail != "" {
			methods = append(methods, "password")
		}
		u.AuthMethods = methods
		users = append(users, u)
	}
	out := &ListUsersOutput{}
	out.Body.Users = users
	return out, nil
}

// ===== CreateUser：POST /auth/admin/users =====

type CreateUserInput struct {
	XUserID   int    `header:"X-User-Id"`
	XUserRole string `header:"X-User-Role"`
	XTenantID int    `header:"X-Tenant-Id"`
	Body      struct {
		DisplayName string `json:"display_name"`
		Role        string `json:"role,omitempty"      doc:"預設 patient；非 super_admin 不可建 super_admin"`
		TenantID    int    `json:"tenant_id,omitempty" doc:"非 super_admin 會被強制蓋成自己 tenant"`
	}
}

type CreateUserOutput struct {
	Status int
	Body   createUserResponse
}

func (h *Handler) HumaCreateUser(ctx context.Context, in *CreateUserInput) (*CreateUserOutput, error) {
	req := in.Body
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		return nil, huma.Error400BadRequest("display_name required")
	}
	if req.Role == "" {
		req.Role = "patient"
	}
	if in.XTenantID != 0 {
		req.TenantID = in.XTenantID
		if req.Role == "super_admin" {
			return nil, huma.Error403Forbidden("only super_admin can create super_admin users")
		}
	}
	if req.Role != "super_admin" && req.TenantID == 0 {
		return nil, huma.Error400BadRequest("tenant_id is required for non-super_admin roles")
	}

	var exists bool
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1 AND active = true)`,
		req.TenantID).Scan(&exists); err != nil {
		return nil, huma.Error500InternalServerError("tenant lookup failed: " + err.Error())
	}
	if !exists {
		return nil, huma.Error400BadRequest("tenant not found or inactive")
	}

	if req.TenantID != 0 {
		var ok bool
		if err := h.engine.DB().QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM tenant_roles tr
				JOIN roles r ON tr.role_id = r.id
				WHERE tr.tenant_id = $1 AND r.name = $2
			)`, req.TenantID, req.Role).Scan(&ok); err != nil {
			return nil, huma.Error500InternalServerError("role check failed: " + err.Error())
		}
		if !ok {
			return nil, huma.Error400BadRequest("role '" + req.Role + "' is not subscribed by this tenant")
		}
	}

	var userID int
	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO users (display_name, role_id, tenant_id, active)
			VALUES ($1, (SELECT id FROM roles WHERE name = $2), $3, true)
			RETURNING id`,
			req.DisplayName, req.Role, req.TenantID).Scan(&userID)
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("create failed: " + err.Error())
	}

	tok, err := generateBindToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("token generation failed")
	}
	if err := h.rdb.Set(ctx, "bind:"+tok, userID, bindTokenTTL).Err(); err != nil {
		return nil, huma.Error500InternalServerError("token store failed: " + err.Error())
	}

	out := &CreateUserOutput{Status: 201}
	out.Body = createUserResponse{
		UserID:     userID,
		Token:      tok,
		BindingURL: buildBindingURL(tok),
		ExpiresAt:  time.Now().Add(bindTokenTTL),
	}
	return out, nil
}

// ===== InvitePatient：POST /auth/admin/users/invite =====

type InvitePatientInput struct {
	XUserID   int    `header:"X-User-Id"`
	XTenantID int    `header:"X-Tenant-Id"`
	Body      struct {
		DisplayName string `json:"display_name"`
	}
}

type InvitePatientOutput struct {
	Status int
	Body   createUserResponse
}

func (h *Handler) HumaInvitePatient(ctx context.Context, in *InvitePatientInput) (*InvitePatientOutput, error) {
	name := strings.TrimSpace(in.Body.DisplayName)
	if name == "" {
		return nil, huma.Error400BadRequest("display_name required")
	}
	if in.XTenantID == 0 {
		return nil, huma.Error400BadRequest("invite requires a real tenant (system tenant cannot invite patients)")
	}

	var tenantActive bool
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT active FROM tenants WHERE id = $1`, in.XTenantID).Scan(&tenantActive); err != nil || !tenantActive {
		return nil, huma.Error400BadRequest("tenant not found or inactive")
	}

	var userID int
	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO users (display_name, role_id, tenant_id, active)
			VALUES ($1, (SELECT id FROM roles WHERE name = 'patient'), $2, true)
			RETURNING id`, name, in.XTenantID).Scan(&userID)
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("create failed: " + err.Error())
	}

	tok, err := generateBindToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("token generation failed")
	}
	if err := h.rdb.Set(ctx, "bind:"+tok, userID, bindTokenTTL).Err(); err != nil {
		return nil, huma.Error500InternalServerError("token store failed: " + err.Error())
	}

	out := &InvitePatientOutput{Status: 201}
	out.Body = createUserResponse{
		UserID:     userID,
		Token:      tok,
		BindingURL: buildBindingURL(tok),
		ExpiresAt:  time.Now().Add(bindTokenTTL),
	}
	return out, nil
}

// ===== UpdateUser：PATCH /auth/admin/users/{id} =====

type UpdateUserInput struct {
	XUserID   int    `header:"X-User-Id"`
	XTenantID int    `header:"X-Tenant-Id"`
	ID        int    `path:"id"`
	Body      struct {
		DisplayName *string `json:"display_name,omitempty"`
		Role        string  `json:"role,omitempty"`
		TenantID    *int    `json:"tenant_id,omitempty"`
		Active      *bool   `json:"active,omitempty"`
	}
}

type updateStatusOut struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
	}
}

func (h *Handler) HumaUpdateUser(ctx context.Context, in *UpdateUserInput) (*updateStatusOut, error) {
	if err := h.ensureTargetInTenantCtx(ctx, in.XTenantID, in.ID); err != nil {
		return nil, err
	}
	req := in.Body
	if in.XTenantID != 0 && req.TenantID != nil && *req.TenantID != in.XTenantID {
		return nil, huma.Error403Forbidden("cannot change user's tenant")
	}

	db := h.engine.DB()

	if req.Role != "" {
		var tenantID int
		if err := db.QueryRow(ctx,
			`SELECT tenant_id FROM users WHERE id = $1`, in.ID).Scan(&tenantID); err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if tenantID != 0 {
			var ok bool
			if err := db.QueryRow(ctx, `
				SELECT EXISTS (
					SELECT 1 FROM tenant_roles tr
					JOIN roles r ON tr.role_id = r.id
					WHERE tr.tenant_id = $1 AND r.name = $2
				)`, tenantID, req.Role).Scan(&ok); err != nil {
				return nil, huma.Error500InternalServerError("role check failed")
			}
			if !ok {
				return nil, huma.Error400BadRequest("role '" + req.Role + "' not subscribed by user's tenant")
			}
		}
	}
	if req.TenantID != nil {
		var ok bool
		if err := db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1 AND active = true)`,
			*req.TenantID).Scan(&ok); err != nil || !ok {
			return nil, huma.Error400BadRequest("tenant not found or inactive")
		}
	}

	err := withAuditCtx(ctx, db, in.XUserID, func(tx pgx.Tx) error {
		if req.DisplayName != nil {
			if _, err := tx.Exec(ctx,
				`UPDATE users SET display_name = $1 WHERE id = $2`, *req.DisplayName, in.ID); err != nil {
				return err
			}
		}
		if req.Role != "" {
			if _, err := tx.Exec(ctx, `
				UPDATE users SET role_id = (SELECT id FROM roles WHERE name = $1)
				WHERE id = $2`, req.Role, in.ID); err != nil {
				return err
			}
		}
		if req.TenantID != nil {
			if _, err := tx.Exec(ctx,
				`UPDATE users SET tenant_id = $1 WHERE id = $2`, *req.TenantID, in.ID); err != nil {
				return err
			}
		}
		if req.Active != nil {
			if _, err := tx.Exec(ctx,
				`UPDATE users SET active = $1 WHERE id = $2`, *req.Active, in.ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}

	if req.Role != "" || req.TenantID != nil || req.Active != nil {
		_ = token.RevokeUser(ctx, h.rdb, in.ID, h.cfg.RefreshTokenExpire)
	}
	out := &updateStatusOut{}
	out.Body.Status = "updated"
	out.Body.ID = in.ID
	return out, nil
}

// ===== UnbindUser：POST /auth/admin/users/{id}/unbind =====

type UnbindUserInput struct {
	XUserID   int `header:"X-User-Id"`
	XTenantID int `header:"X-Tenant-Id"`
	ID        int `path:"id"`
}

type unbindUserOut struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
	}
}

func (h *Handler) HumaUnbindUser(ctx context.Context, in *UnbindUserInput) (*unbindUserOut, error) {
	if err := h.ensureTargetInTenantCtx(ctx, in.XTenantID, in.ID); err != nil {
		return nil, err
	}
	var exists bool
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, in.ID).Scan(&exists); err != nil {
		return nil, huma.Error500InternalServerError("lookup failed: " + err.Error())
	}
	if !exists {
		return nil, huma.Error404NotFound("user not found")
	}

	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		_, execErr := tx.Exec(ctx,
			`UPDATE users SET line_uuid = NULL, active = false WHERE id = $1`, in.ID)
		return execErr
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("unbind failed: " + err.Error())
	}
	_ = token.RevokeUser(ctx, h.rdb, in.ID, h.cfg.RefreshTokenExpire)

	out := &unbindUserOut{}
	out.Body.Status = "unbound"
	out.Body.ID = in.ID
	return out, nil
}

// ===== DeleteUser：DELETE /auth/admin/users/{id}（軟刪除）=====

type DeleteUserInput struct {
	XUserID   int `header:"X-User-Id"`
	XTenantID int `header:"X-Tenant-Id"`
	ID        int `path:"id"`
}

type deleteUserOut struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
	}
}

func (h *Handler) HumaDeleteUser(ctx context.Context, in *DeleteUserInput) (*deleteUserOut, error) {
	if in.XUserID == in.ID {
		return nil, huma.Error400BadRequest("cannot delete yourself")
	}
	if err := h.ensureTargetInTenantCtx(ctx, in.XTenantID, in.ID); err != nil {
		return nil, err
	}

	var roleName string
	var alreadyDeleted bool
	err := h.engine.DB().QueryRow(ctx, `
		SELECT r.name, u.deleted_at IS NOT NULL
		FROM users u JOIN roles r ON u.role_id = r.id
		WHERE u.id = $1`, in.ID).Scan(&roleName, &alreadyDeleted)
	if err != nil {
		return nil, huma.Error404NotFound("user not found")
	}
	if alreadyDeleted {
		return nil, huma.Error409Conflict("user already deleted")
	}
	if roleName == "super_admin" {
		return nil, huma.NewError(423, "super_admin user cannot be deleted")
	}

	err = withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		_, execErr := tx.Exec(ctx, `
			UPDATE users
			SET deleted_at = NOW(),
			    deleted_by = NULLIF(current_setting('app.current_user', true), '')::INT,
			    active     = false,
			    line_uuid  = NULL
			WHERE id = $1`, in.ID)
		return execErr
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("delete failed: " + err.Error())
	}
	_ = token.RevokeUser(ctx, h.rdb, in.ID, h.cfg.RefreshTokenExpire)

	out := &deleteUserOut{}
	out.Body.Status = "deleted"
	out.Body.ID = in.ID
	return out, nil
}

// ===== RegenerateBindToken：POST /auth/admin/users/{id}/binding-token =====

type RegenerateBindTokenInput struct {
	XTenantID int `header:"X-Tenant-Id"`
	ID        int `path:"id"`
}

type RegenerateBindTokenOutput struct {
	Body createUserResponse
}

func (h *Handler) HumaRegenerateBindToken(ctx context.Context, in *RegenerateBindTokenInput) (*RegenerateBindTokenOutput, error) {
	if err := h.ensureTargetInTenantCtx(ctx, in.XTenantID, in.ID); err != nil {
		return nil, err
	}

	var lineUUID *string
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT line_uuid FROM users WHERE id = $1`, in.ID).Scan(&lineUUID); err != nil {
		return nil, huma.Error404NotFound("user not found")
	}
	if lineUUID != nil && *lineUUID != "" {
		return nil, huma.Error409Conflict("user already bound to LINE")
	}

	tok, err := generateBindToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("token generation failed")
	}
	if err := h.rdb.Set(ctx, "bind:"+tok, in.ID, bindTokenTTL).Err(); err != nil {
		return nil, huma.Error500InternalServerError("token store failed: " + err.Error())
	}
	out := &RegenerateBindTokenOutput{}
	out.Body = createUserResponse{
		UserID:     in.ID,
		Token:      tok,
		BindingURL: buildBindingURL(tok),
		ExpiresAt:  time.Now().Add(bindTokenTTL),
	}
	return out, nil
}

// ===== SetUserPassword：POST /auth/admin/users/{id}/password =====

type SetUserPasswordInput struct {
	XUserID   int `header:"X-User-Id"`
	XTenantID int `header:"X-Tenant-Id"`
	ID        int `path:"id"`
	Body      struct {
		Email    string `json:"email"`
		Password string `json:"password" minLength:"8"`
	}
}

type setPasswordOut struct {
	Body struct {
		Status string `json:"status"`
		ID     int    `json:"id"`
		Email  string `json:"email"`
	}
}

func (h *Handler) HumaSetUserPassword(ctx context.Context, in *SetUserPasswordInput) (*setPasswordOut, error) {
	if err := h.ensureTargetInTenantCtx(ctx, in.XTenantID, in.ID); err != nil {
		return nil, err
	}
	email := strings.TrimSpace(in.Body.Email)
	if email == "" {
		return nil, huma.Error400BadRequest("email required")
	}
	if len(in.Body.Password) < 8 {
		return nil, huma.Error400BadRequest("password must be at least 8 characters")
	}

	if in.XTenantID != 0 {
		var targetRole string
		if err := h.engine.DB().QueryRow(ctx, `
			SELECT r.name FROM users u JOIN roles r ON u.role_id = r.id
			WHERE u.id = $1`, in.ID).Scan(&targetRole); err == nil && targetRole == "super_admin" {
			return nil, huma.Error403Forbidden("cannot set password for super_admin")
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(in.Body.Password), 10)
	if err != nil {
		return nil, huma.Error500InternalServerError("password hash failed")
	}
	err = withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		_, execErr := tx.Exec(ctx,
			`UPDATE users SET google_email = $1, password_hash = $2 WHERE id = $3`,
			email, string(hash), in.ID)
		return execErr
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("update failed: " + err.Error())
	}
	_ = token.RevokeUser(ctx, h.rdb, in.ID, h.cfg.RefreshTokenExpire)

	out := &setPasswordOut{}
	out.Body.Status = "password updated"
	out.Body.ID = in.ID
	out.Body.Email = email
	return out, nil
}
