package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	AuthDatabaseURL    string
	RedisURL           string
	JWTSecret          string
	AccessTokenExpire  time.Duration
	RefreshTokenExpire time.Duration
	LineChannelSecret  string
	GoogleClientID     string
	GoogleClientSecret string
	Env                string
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
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		Env:                getEnv("ENV", "development"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
