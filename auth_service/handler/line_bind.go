package handler

import (
	"context"
	"errors"
)

// line_bind.go：LineBind handler 從此處移至 huma_login.go，僅保留 helper。

// ensureNotAlreadyBound：拒絕「這個 user 已綁 LINE」以及「這個 LINE UUID 已綁
// 給別人」兩種衝突。errors.New 的訊息會直接當 409 body 回傳。
func (h *Handler) ensureNotAlreadyBound(ctx context.Context, userID int, lineUUID string) error {
	var existing *string
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT line_uuid FROM users WHERE id = $1`, userID).Scan(&existing); err != nil {
		return err
	}
	if existing != nil && *existing != "" {
		return errors.New("user already bound")
	}

	var otherID *int
	if err := h.engine.DB().QueryRow(ctx,
		`SELECT id FROM users WHERE line_uuid = $1`, lineUUID).Scan(&otherID); err != nil {
		// pgx: errNoRows → 還沒綁，放行
		if err.Error() == "no rows in result set" {
			return nil
		}
		return nil
	}
	if otherID != nil {
		return errors.New("this LINE account is already bound to another user")
	}
	return nil
}
