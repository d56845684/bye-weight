package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	AuthDatabaseURL      string
	RedisURL             string
	JWTSecret            string
	AccessTokenExpire    time.Duration
	RefreshTokenExpire   time.Duration
	LineChannelSecret    string
	// Messaging API channel access token — 打 /v2/bot/profile/{uid} 驗 follower 狀態用。
	// 空字串 → friendship-check endpoint 回 is_friend=null（前端 degrade 到保守行為）。
	LineChannelAccessToken string
	GoogleClientID       string
	GoogleClientSecret   string
	Env                  string
	// Shared secret for service-to-service calls hitting /auth/internal/*
	// （LINE webhook 之類 no-user-JWT 的情境）。空字串 → internal endpoints fail-close。
	InternalServiceToken string
	// Dev super_admin 的 email / password。auth_service 啟動時會拿來 UPSERT 密碼
	// identity。Password 空字串 → 不動 DB，保留先前（migration 0003 或上次啟動）
	// 種的密碼。Production 建議不要設（透過 SSO 登入）。
	SuperAdminEmail    string
	SuperAdminPassword string
}

func Load() *Config {
	accessExp, _ := strconv.Atoi(getEnv("ACCESS_TOKEN_EXPIRE", "900"))
	refreshExp, _ := strconv.Atoi(getEnv("REFRESH_TOKEN_EXPIRE", "604800"))

	return &Config{
		AuthDatabaseURL:    getEnv("AUTH_DATABASE_URL", "postgres://postgres:dev@localhost:5433/auth_db?sslmode=disable"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6380/0"),
		JWTSecret:          getEnv("JWT_SECRET_KEY", ""),
		AccessTokenExpire:  time.Duration(accessExp) * time.Second,
		RefreshTokenExpire: time.Duration(refreshExp) * time.Second,
		LineChannelSecret:  getEnv("LINE_CHANNEL_SECRET", ""),
		LineChannelAccessToken: getEnv("LINE_CHANNEL_ACCESS_TOKEN", ""),
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		Env:                  getEnv("ENV", "development"),
		InternalServiceToken: getEnv("INTERNAL_SERVICE_TOKEN", ""),
		SuperAdminEmail:      getEnv("SUPER_ADMIN_EMAIL", "admin@dev.local"),
		SuperAdminPassword:   getEnv("SUPER_ADMIN_PASSWORD", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
