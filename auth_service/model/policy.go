package model

type Policy struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Effect string `json:"effect"`
}

type PolicyCondition struct {
	ID            int               `json:"id"`
	PolicyID      int               `json:"policy_id"`
	ConditionType string            `json:"condition_type"`
	Operator      string            `json:"operator"`
	ValueConfig   map[string]string `json:"value_config"`
}

type PermissionRoute struct {
	PermissionName string
	URLPattern     string
	HTTPMethod     string
}
