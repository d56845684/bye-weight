package handler

import (
	"encoding/json"
	"net/http"
	"regexp"
)

// admin_roles.go：handler 都已移至 huma_admin_roles.go / huma_admin_policies.go。
// 保留共用型別、常數、正則、writeJSON helper（admin_tenants 系 chi handler 還用到）。

// 系統保護的角色：不可刪除；super_admin 還不可改 policy 綁定
var lockedFromDelete = map[string]bool{
	"super_admin": true,
	"patient":     true,
}
var lockedFromPolicyEdit = map[string]bool{
	"super_admin": true,
}

var roleNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)

type roleRow struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	UserCount   int    `json:"user_count"`
	PolicyCount int    `json:"policy_count"`
	Locked      bool   `json:"locked"`
}

type policyRow struct {
	ID       int             `json:"id"`
	Name     string          `json:"name"`
	TenantID int             `json:"tenant_id"` // 0 = 系統級；>0 = 某 tenant 自有
	Document json.RawMessage `json:"document"`
}

// writeJSON：chi handler（admin_tenants 系還沒遷）仍在用。
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
