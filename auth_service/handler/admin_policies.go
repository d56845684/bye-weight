package handler

import "encoding/json"

// admin_policies.go：handler 都已移至 huma_admin_policies.go。保留共用型別。

type policyDetail struct {
	ID        int             `json:"id"`
	Name      string          `json:"name"`
	TenantID  int             `json:"tenant_id"`
	Document  json.RawMessage `json:"document"`
	RoleNames []string        `json:"role_names"`
}
