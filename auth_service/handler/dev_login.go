package handler

import (
	"context"
)

// dev_login.go：DevLogin handler 從此處移至 huma_login.go，僅保留 helper。

type devLoginRequest struct {
	UserID   int    `json:"user_id,omitempty"`
	LineUUID string `json:"line_uuid,omitempty"`
}

// findUserForDevLogin：依 user_id 或 line_uuid 查 active user。
// user_id 優先；皆空時預設 line_uuid='dev-admin'（migration 000003 有 seed）。
func (h *Handler) findUserForDevLogin(ctx context.Context, req devLoginRequest) (*userRow, error) {
	var u userRow
	var err error
	switch {
	case req.UserID > 0:
		err = h.engine.DB().QueryRow(ctx, `
			SELECT u.id, r.name, u.tenant_id
			FROM users u JOIN roles r ON u.role_id = r.id
			WHERE u.id = $1 AND u.active = true
		`, req.UserID).Scan(&u.ID, &u.RoleName, &u.TenantID)
	default:
		lineUUID := req.LineUUID
		if lineUUID == "" {
			lineUUID = "dev-admin"
		}
		err = h.engine.DB().QueryRow(ctx, `
			SELECT u.id, r.name, u.tenant_id
			FROM users u JOIN roles r ON u.role_id = r.id
			WHERE u.line_uuid = $1 AND u.active = true
		`, lineUUID).Scan(&u.ID, &u.RoleName, &u.TenantID)
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
