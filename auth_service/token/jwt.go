package token

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Claims struct {
	UserID    int    `json:"user_id"`
	Role      string `json:"role"`
	ClinicID  string `json:"clinic_id"`
	PatientID int    `json:"patient_id,omitempty"`
	TokenType string `json:"type"`
	jwt.RegisteredClaims
}

func Issue(userID int, role, clinicID string, patientID int,
	tokenType string, ttl time.Duration, secret string) (string, error) {

	claims := Claims{
		UserID:    userID,
		Role:      role,
		ClinicID:  clinicID,
		PatientID: patientID,
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
