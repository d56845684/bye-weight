package handler

import (
	"context"
	"errors"
)

// line_bind.go：LineBind handler 從此處移至 huma_login.go，僅保留 helper。

// ensureNotAlreadyBound：拒絕「這個 user 已綁 LINE」以及「這個 LINE UUID 已綁
// 給別人」兩種衝突。查 auth_identities。errors.New 的訊息會直接當 409 body 回傳。
//
// 用 EXISTS 而非 SELECT 1 + ErrNoRows —— 永遠回一個 bool row，沒特殊錯誤分支。
// partial unique index (provider, subject) + (user_id, provider) 讓這兩個 EXISTS
// 查詢各自都是單次 index probe，cost 很低。
func (h *Handler) ensureNotAlreadyBound(ctx context.Context, userID int, lineUUID string) error {
	var userHasLine, uuidTakenByOther bool
	err := h.engine.DB().QueryRow(ctx, `
		SELECT
		    EXISTS(SELECT 1 FROM auth_identities
		           WHERE user_id = $1 AND provider = 'line' AND deleted_at IS NULL),
		    EXISTS(SELECT 1 FROM auth_identities
		           WHERE provider = 'line' AND subject = $2 AND deleted_at IS NULL
		             AND user_id <> $1)
	`, userID, lineUUID).Scan(&userHasLine, &uuidTakenByOther)
	if err != nil {
		return err
	}
	if userHasLine {
		return errors.New("user already bound")
	}
	if uuidTakenByOther {
		return errors.New("this LINE account is already bound to another user")
	}
	return nil
}
