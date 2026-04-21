package handler

import (
	"context"
)

// password_login.go：PasswordLogin handler 從此處移至 huma_login.go，僅保留 helper。

// findUserWithPassword：用 email + password identity 找 active user。
// 密碼比對由 caller 做（bcrypt），這個函式只負責查 DB。
// email 在 auth_identities 表中以 (provider='password', subject=email) 存放。
func (h *Handler) findUserWithPassword(ctx context.Context, email string) (*userRow, string, error) {
	var u userRow
	var hash string
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id, i.secret_hash
		FROM users u
		JOIN roles r ON u.role_id = r.id
		JOIN auth_identities i ON i.user_id = u.id
		WHERE i.provider = 'password'
		  AND i.subject = $1
		  AND i.secret_hash IS NOT NULL
		  AND i.deleted_at IS NULL
		  AND u.active = true
		  AND u.deleted_at IS NULL
	`, email).Scan(&u.ID, &u.RoleName, &u.TenantID, &hash)
	if err != nil {
		return nil, "", err
	}
	return &u, hash, nil
}
