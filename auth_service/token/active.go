package token

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Redis 快取 users.active / tenants.active 的結果，避免每個 /api/verify 都
// 打 auth_db。寫入端（admin 停用 user / tenant、綁定流程重新啟用 user 等）
// 必須在 UPDATE 之後呼叫 Invalidate*；TTL 只是安全網。
//
// 值用字串 "1" / "0" 便於肉眼 debug (redis-cli GET ...)，不用 int bit。

const activeCacheTTL = 5 * time.Minute

func userActiveKey(userID int) string     { return fmt.Sprintf("auth:user:active:%d", userID) }
func tenantActiveKey(tenantID int) string { return fmt.Sprintf("auth:tenant:active:%d", tenantID) }

// IsUserActive：cache-first 查詢。miss 時打 DB 並回填。
// fail-closed：Redis 故障直接回 error，caller 應回 503 讓整條 chain 擋下。
// user 不存在 → (false, pgx.ErrNoRows)，caller 判斷成 401 "user not found"。
func IsUserActive(ctx context.Context, rdb *redis.Client, db *pgxpool.Pool, userID int) (bool, error) {
	key := userActiveKey(userID)
	val, err := rdb.Get(ctx, key).Result()
	if err == nil {
		return val == "1", nil
	}
	if !errors.Is(err, redis.Nil) {
		return false, err
	}
	var active bool
	if err := db.QueryRow(ctx, `SELECT active FROM users WHERE id = $1`, userID).Scan(&active); err != nil {
		return false, err
	}
	writeActive(ctx, rdb, key, active)
	return active, nil
}

// IsTenantActive：同 IsUserActive，對 tenants 表。
func IsTenantActive(ctx context.Context, rdb *redis.Client, db *pgxpool.Pool, tenantID int) (bool, error) {
	key := tenantActiveKey(tenantID)
	val, err := rdb.Get(ctx, key).Result()
	if err == nil {
		return val == "1", nil
	}
	if !errors.Is(err, redis.Nil) {
		return false, err
	}
	var active bool
	if err := db.QueryRow(ctx, `SELECT active FROM tenants WHERE id = $1`, tenantID).Scan(&active); err != nil {
		return false, err
	}
	writeActive(ctx, rdb, key, active)
	return active, nil
}

// InvalidateUserActive：admin 切 active / 拔綁 / 刪除 / 綁定時必叫。
// 下一次 verify 打的 IsUserActive 會 cache miss，從 DB 重新讀最新值。
func InvalidateUserActive(ctx context.Context, rdb *redis.Client, userID int) error {
	return rdb.Del(ctx, userActiveKey(userID)).Err()
}

// InvalidateTenantActive：admin 切 tenant active / 刪除時必叫。
func InvalidateTenantActive(ctx context.Context, rdb *redis.Client, tenantID int) error {
	return rdb.Del(ctx, tenantActiveKey(tenantID)).Err()
}

func writeActive(ctx context.Context, rdb *redis.Client, key string, active bool) {
	v := "0"
	if active {
		v = "1"
	}
	// best-effort：寫失敗下次再 miss 重寫
	_ = rdb.SetEx(ctx, key, v, activeCacheTTL).Err()
}

// 導出給 handler 區分「user 不存在」vs「DB error」的 sentinel。
var ErrNotFound = pgx.ErrNoRows
