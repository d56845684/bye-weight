package model

import "time"

type User struct {
	ID          int       `json:"id"`
	LineUUID    *string   `json:"line_uuid,omitempty"`
	GoogleEmail *string   `json:"google_email,omitempty"`
	RoleID      int       `json:"role_id"`
	RoleName    string    `json:"role_name"`
	TenantID    int       `json:"tenant_id"`
	DisplayName *string   `json:"display_name,omitempty"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Role struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type Tenant struct {
	ID     int    `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}
