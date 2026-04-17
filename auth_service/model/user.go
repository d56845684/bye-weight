package model

import "time"

type User struct {
	ID           int       `json:"id"`
	LineUUID     *string   `json:"line_uuid,omitempty"`
	GoogleEmail  *string   `json:"google_email,omitempty"`
	RoleID       int       `json:"role_id"`
	RoleName     string    `json:"role_name"`
	ClinicID     string    `json:"clinic_id"`
	PatientID    int       `json:"patient_id,omitempty"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

type Role struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type Permission struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	URLPattern string `json:"url_pattern"`
	HTTPMethod string `json:"http_method"`
}
