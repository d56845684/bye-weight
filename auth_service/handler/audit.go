package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// actingUserID 從 Nginx 注入的 X-User-Id header 取值。
// 只有 /auth/v1/admin/* 路徑有這個 header；login / refresh 等公開端點沒有。
func actingUserID(r *http.Request) int {
	id, _ := strconv.Atoi(r.Header.Get("X-User-Id"))
	return id
}

// callerTenantID 從 X-Tenant-Id header 取；0 代表 system tenant = super_admin。
// 非 super_admin 的 admin handler 用這個值來限縮查詢 / 操作範圍。
func callerTenantID(r *http.Request) int {
	id, _ := strconv.Atoi(r.Header.Get("X-Tenant-Id"))
	return id
}

// isSuperAdmin：caller 是否為 super_admin（system tenant）。
func isSuperAdmin(r *http.Request) bool {
	return callerTenantID(r) == 0
}

// withAudit 在一個 transaction 內先 SET LOCAL app.current_user，再呼叫 fn 執行
// INSERT / UPDATE / DELETE。trigger audit_autofill() 就能讀到 user_id 寫入
// created_by / updated_by 欄位。chi handlers 用；huma 那邊請改用 withAuditCtx
// 直接傳 context + actingUID。
//
//	err := withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
//	    _, err := tx.Exec(r.Context(),
//	        "UPDATE users SET display_name=$1 WHERE id=$2", name, id)
//	    return err
//	})
func withAudit(r *http.Request, db *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	return withAuditCtx(r.Context(), db, actingUserID(r), fn)
}

// withAuditCtx 是 huma-friendly 版本：caller 自己從 huma Input 拿 acting user id
// （header:"X-User-Id"），省掉 *http.Request 依賴。
func withAuditCtx(ctx context.Context, db *pgxpool.Pool, actingUID int, fn func(tx pgx.Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if actingUID > 0 {
		if _, err := tx.Exec(ctx,
			"SELECT set_config('app.current_user', $1, true)",
			fmt.Sprint(actingUID)); err != nil {
			return err
		}
	}

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// applyAuditContext：給手動管理 tx 的複雜 handler 用（例如多步驟 tx）。
// 在 tx 開始後馬上呼叫一次，後續所有 INSERT / UPDATE 都會被 trigger 填 user。
func applyAuditContext(ctx context.Context, tx pgx.Tx, r *http.Request) error {
	uid := actingUserID(r)
	if uid <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx,
		"SELECT set_config('app.current_user', $1, true)",
		fmt.Sprint(uid))
	return err
}

// logLogin：稽核登入事件，寫入 login_logs（best-effort，失敗不影響主流程）
// method 代表登入方式：line / password / dev / line_bind / google
func logLogin(ctx context.Context, db *pgxpool.Pool, userID int, r *http.Request, method string) error {
	ip := clientIP(r)
	ua := r.UserAgent()
	_, err := db.Exec(ctx, `
		INSERT INTO login_logs (user_id, ip, user_agent)
		VALUES ($1, $2, $3)`, userID, ip, method+" "+ua)
	return err
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		// 取第一段
		for i, c := range v {
			if c == ',' {
				return v[:i]
			}
		}
		return v
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	return r.RemoteAddr
}
