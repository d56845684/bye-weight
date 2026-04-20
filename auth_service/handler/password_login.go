package handler

import (
	"context"
)

// password_login.go：PasswordLogin handler 從此處移至 huma_login.go，僅保留 helper。

// findUserWithPassword：用 email + password_hash 找 active user。
// 密碼比對由 caller 做（bcrypt），這個函式只負責查 DB。
func (h *Handler) findUserWithPassword(ctx context.Context, email string) (*userRow, string, error) {
	var u userRow
	var hash string
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id, u.password_hash
		FROM users u JOIN roles r ON u.role_id = r.id
		WHERE u.google_email = $1 AND u.active = true AND u.password_hash IS NOT NULL
	`, email).Scan(&u.ID, &u.RoleName, &u.TenantID, &hash)
	if err != nil {
		return nil, "", err
	}
	return &u, hash, nil
}
