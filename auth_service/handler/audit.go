package handler

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
