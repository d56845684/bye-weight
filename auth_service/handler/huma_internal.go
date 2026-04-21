package handler

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
)

// /auth/internal/* — 服務對服務端點，不走 user JWT / cookie。
// 保護方式：X-Internal-Token header 比對 cfg.InternalServiceToken（shared
// secret）。token 空字串 → 所有 internal endpoint fail-close（401）。
//
// 典型呼叫者：main_service 的 LINE webhook。LINE 打進來沒有 user JWT，
// 要靠 sender 的 LINE UUID 反查 role + tenant_id，所以 main_service 透過
// internal endpoint 問 auth_service。
//
// 這類 endpoint 放在獨立檔，避免跟 public API handlers 混淆。將來要不要從
// OpenAPI public doc 拿掉是另一個問題（目前一併產出，但 URL prefix 清楚）。

type ResolveSenderByLineUUIDInput struct {
	LineUUID      string `query:"uuid" doc:"LINE user UUID（event.source.userId）"`
	InternalToken string `header:"X-Internal-Token" doc:"shared secret；與 cfg.InternalServiceToken 比對"`
}

type ResolveSenderByLineUUIDOutput struct {
	Body struct {
		UserID      int     `json:"user_id"`
		Role        string  `json:"role"`
		TenantID    int     `json:"tenant_id"`
		DisplayName *string `json:"display_name"`
	}
}

// HumaResolveSenderByLineUUID：GET /auth/internal/users/by-line-uuid?uuid=...
//
// 以 LINE UUID 查 active + 未軟刪的 user；找不到回 404。
// fail-close：cfg.InternalServiceToken 為空（dev 忘了設）→ 一律 401，避免誤放行。
func (h *Handler) HumaResolveSenderByLineUUID(
	ctx context.Context, in *ResolveSenderByLineUUIDInput,
) (*ResolveSenderByLineUUIDOutput, error) {
	if h.cfg.InternalServiceToken == "" || in.InternalToken != h.cfg.InternalServiceToken {
		return nil, huma.Error401Unauthorized("invalid internal token")
	}
	if in.LineUUID == "" {
		return nil, huma.Error400BadRequest("uuid required")
	}

	var uid, tid int
	var role string
	var displayName *string
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id, u.display_name
		FROM users u
		JOIN roles r ON u.role_id = r.id
		JOIN auth_identities i ON i.user_id = u.id
		WHERE i.provider = 'line'
		  AND i.subject = $1
		  AND i.deleted_at IS NULL
		  AND u.active = true
		  AND u.deleted_at IS NULL
	`, in.LineUUID).Scan(&uid, &role, &tid, &displayName)
	if err != nil {
		return nil, huma.Error404NotFound("user not found")
	}

	out := &ResolveSenderByLineUUIDOutput{}
	out.Body.UserID = uid
	out.Body.Role = role
	out.Body.TenantID = tid
	out.Body.DisplayName = displayName
	return out, nil
}
