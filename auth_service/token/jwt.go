package token

import (
	"context"
	"fmt"
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
