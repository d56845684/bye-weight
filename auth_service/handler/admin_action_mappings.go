package handler

// admin_action_mappings.go：handler 已移至 huma_admin_misc.go。保留共用型別 + 白名單。

type actionMappingRow struct {
	ID               int    `json:"id"`
	ServiceID        int    `json:"service_id"`
	ServiceName      string `json:"service_name"`
	HTTPMethod       string `json:"http_method"`
	URLPattern       string `json:"url_pattern"`
	Action           string `json:"action"`
	ResourceTemplate string `json:"resource_template"`
}

var allowedHTTPMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
}
