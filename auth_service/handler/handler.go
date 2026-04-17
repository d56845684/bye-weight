package handler

import (
	"auth_service/config"
	"auth_service/engine"

	"github.com/redis/go-redis/v9"
)

type Handler struct {
	cfg    *config.Config
	engine *engine.Engine
	rdb    *redis.Client
}

func New(cfg *config.Config, eng *engine.Engine, rdb *redis.Client) *Handler {
	return &Handler{
		cfg:    cfg,
		engine: eng,
		rdb:    rdb,
	}
}
