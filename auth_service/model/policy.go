package model

// Service 是對 auth 註冊的下游服務（main_service / auth_service 自己 / 其他）
type Service struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Prefix string `json:"prefix"`
}

// ActionMapping：HTTP 請求 → (action, resource ARN template)
type ActionMapping struct {
	ID               int    `json:"id"`
	ServiceID        int    `json:"service_id"`
	ServiceName      string `json:"service_name"`
	ServicePrefix    string `json:"service_prefix"`
	HTTPMethod       string `json:"http_method"`
	URLPattern       string `json:"url_pattern"`
	Action           string `json:"action"`
	ResourceTemplate string `json:"resource_template"`
}

// PolicyDocument 對應 policies.document JSONB
type PolicyDocument struct {
	Statements []Statement `json:"statements"`
}

// Statement 單一 allow/deny 條款
type Statement struct {
	Effect     string                   `json:"effect"`     // "allow" / "deny"
	Actions    []string                 `json:"actions"`    // e.g. ["main:food_log:*"]
	Resources  []string                 `json:"resources"`  // e.g. ["main:tenant/${auth:tenant_id}/*"]
	Conditions map[string]map[string]any `json:"conditions,omitempty"`
	// conditions 範例：
	// {
	//   "StringEquals": { "${auth:tenant_id}": "${main:tenant_id}" },
	//   "DateBetween":  { "${ctx:time_of_day}": ["08:00", "20:00"] }
	// }
}

// Policy 對應 policies 表
type Policy struct {
	ID       int            `json:"id"`
	Name     string         `json:"name"`
	Document PolicyDocument `json:"document"`
}
