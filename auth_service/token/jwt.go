package token

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Claims：IAM 風格的最小 identity claim。
// 領域欄位（patient_id / clinic_id 等）不再出現於 JWT；各服務自己從 X-User-Id 解析身份。
type Claims struct {
	UserID    int    `json:"user_id"`
	Role      string `json:"role"`
	TenantID  int    `json:"tenant_id"`
	TokenType string `json:"type"` // access / refresh
	jwt.RegisteredClaims
}

// Issue 發行 JWT。tenantID=0 代表 system tenant（super_admin 用）。
func Issue(userID int, role string, tenantID int,
	tokenType string, ttl time.Duration, secret string) (string, error) {

	claims := Claims{
		UserID:    userID,
		Role:      role,
		TenantID:  tenantID,
		TokenType: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.New().String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte(secret))
}

func Parse(tokenStr, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{},
		func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return []byte(secret), nil
		})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return token.Claims.(*Claims), nil
}

func Revoke(ctx context.Context, rdb *redis.Client, jti string, exp time.Time) error {
	ttl := time.Until(exp)
	if ttl <= 0 {
		return nil
	}
	return rdb.SetEx(ctx, "auth:blacklist:"+jti, "1", ttl).Err()
}

func IsRevoked(ctx context.Context, rdb *redis.Client, jti string) (bool, error) {
	n, err := rdb.Exists(ctx, "auth:blacklist:"+jti).Result()
	return n > 0, err
}

// RevokeUser 在 Redis 寫 auth:user_revoke:{user_id} = now_unix，使該 user
// 目前所有簽發時間早於此的 JWT 全部失效。admin 拔 LINE 綁定、停用、改角色 /
// 切換 tenant 時都應呼叫。TTL = refresh token 最長效期（之後新發的 JWT 以
// iat 通過檢查，key 到期可清掉）。
func RevokeUser(ctx context.Context, rdb *redis.Client, userID int, ttl time.Duration) error {
	key := fmt.Sprintf("auth:user_revoke:%d", userID)
	return rdb.SetEx(ctx, key, fmt.Sprint(time.Now().Unix()), ttl).Err()
}

// IsUserRevoked 檢查該 user 有沒有被 RevokeUser 吊銷過，且 JWT 的 iat 比
// 吊銷時間早。沒紀錄 → false。
func IsUserRevoked(ctx context.Context, rdb *redis.Client, userID int, iat time.Time) (bool, error) {
	key := fmt.Sprintf("auth:user_revoke:%d", userID)
	val, err := rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	revokeTs, parseErr := strconv.ParseInt(val, 10, 64)
	if parseErr != nil {
		// 壞資料保守當「未吊銷」避免誤殺，但應該 log
		return false, nil
	}
	return iat.Unix() < revokeTs, nil
}
