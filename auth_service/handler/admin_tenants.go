package handler

import "regexp"

// admin_tenants.go：handler 都已移至 huma_admin_tenants.go（batch 5）。
// 保留共用型別、預設清單、正則。

var tenantSlugRe = regexp.MustCompile(`^[a-z][a-z0-9-]{1,49}$`)

// 新 tenant 建立時預設訂閱的服務與角色（不含 admin / super_admin；這些是系統級）。
// admin 加進去讓該 tenant 的 clinic-admin 能進 /admin/* 後台。
var defaultTenantServices = []string{"auth", "main", "frontend", "admin"}
var defaultTenantRoles = []string{"patient", "staff", "nutritionist", "admin"}

type tenantRow struct {
	ID           int    `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	Active       bool   `json:"active"`
	ServiceCount int    `json:"service_count"`
	RoleCount    int    `json:"role_count"`
	UserCount    int    `json:"user_count"`
	Locked       bool   `json:"locked"` // system tenant 不可編
}
