package handler

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"time"
)

// admin_users.go：所有 handler 都已移至 huma_admin_users.go（batch 3）。
// 此檔只保留共用型別、常數、helper。

const bindTokenTTL = 7 * 24 * time.Hour

type adminUserRow struct {
	ID          int     `json:"id"`
	DisplayName *string `json:"display_name"`
	Role        string  `json:"role"`
	TenantID    int     `json:"tenant_id"`
	TenantSlug  string  `json:"tenant_slug"`
	Active      bool    `json:"active"`
	// AuthMethods：該 user 有哪些登入路徑（line / password / google / apple ...）。
	// 從 auth_identities 表 aggregate；空陣列 = pending（admin 尚未發綁定或設密碼）。
	// 保留此欄位（向後相容）+ 同步吐 Identities（更細的資訊：subject / 綁定時間）。
	AuthMethods []string           `json:"auth_methods"`
	Identities  []adminUserIdentity `json:"identities"`
}

type adminUserIdentity struct {
	Provider   string     `json:"provider"`
	Subject    string     `json:"subject"`     // LINE UUID / email / google sub / apple sub
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

type createUserResponse struct {
	UserID     int       `json:"user_id"`
	Token      string    `json:"binding_token"`
	BindingURL string    `json:"binding_url"`
	ExpiresAt  time.Time `json:"expires_at"`
}

func generateBindToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// buildBindingURL：優先用 LIFF URL（LINE 可直接開），否則 fallback 到相對路徑。
// huma 版本不再依賴 *http.Request —— 只吃 token。
func buildBindingURL(token string) string {
	if liff := os.Getenv("LIFF_ID"); liff != "" {
		return "https://liff.line.me/" + liff + "?token=" + token
	}
	return "/liff?token=" + token
}
