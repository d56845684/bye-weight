package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// login.go：LINE 登入 / 綁定流共用的 helpers + 資料結構。
// handler 入口（HumaLineLogin / HumaLineBind）在 huma_login.go。

type lineProfile struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
}

// verifyLineToken：向 LINE API 驗 access token，回該 LINE 使用者 profile。
func verifyLineToken(accessToken string) (*lineProfile, error) {
	req, _ := http.NewRequest("GET", "https://api.line.me/v2/profile", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("LINE API error: %s", body)
	}

	var profile lineProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, err
	}
	return &profile, nil
}

// userRow：登入流程內部用的輕量投影 —— 最少欄位即可發 JWT。
type userRow struct {
	ID       int
	RoleName string
	TenantID int
}

// findUserByLineUUID：以 LINE UUID 查對應的 active user。用於 LineLogin /
// LineBind post-bind re-lookup。
func (h *Handler) findUserByLineUUID(ctx context.Context, lineUUID string) (*userRow, error) {
	var u userRow
	err := h.engine.DB().QueryRow(ctx, `
		SELECT u.id, r.name, u.tenant_id
		FROM users u
		JOIN roles r ON u.role_id = r.id
		WHERE u.line_uuid = $1 AND u.active = true
	`, lineUUID).Scan(&u.ID, &u.RoleName, &u.TenantID)
	if err != nil {
		return nil, err
	}
	return &u, nil
}
