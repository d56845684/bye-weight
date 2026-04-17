package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const bindTokenTTL = 7 * 24 * time.Hour

var clinicIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,20}$`)

type adminUserRow struct {
	ID             int     `json:"id"`
	DisplayName    *string `json:"display_name"`
	LineUUID       *string `json:"line_uuid"`
	GoogleEmail    *string `json:"google_email"`
	Role           string  `json:"role"`
	ClinicID       string  `json:"clinic_id"`
	PatientID      *int    `json:"patient_id"`
	Active         bool    `json:"active"`
	BindingStatus  string  `json:"binding_status"` // bound / pending / password_only
}

// ListUsers：GET /auth/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(), `
		SELECT u.id, u.display_name, u.line_uuid, u.google_email,
		       r.name, u.clinic_id, u.patient_id, u.active
		FROM users u JOIN roles r ON u.role_id = r.id
		ORDER BY u.id`)
	if err != nil {
		http.Error(w, "query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	users := []adminUserRow{}
	for rows.Next() {
		var u adminUserRow
		if err := rows.Scan(
			&u.ID, &u.DisplayName, &u.LineUUID, &u.GoogleEmail,
			&u.Role, &u.ClinicID, &u.PatientID, &u.Active,
		); err != nil {
			http.Error(w, "scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		switch {
		case u.LineUUID != nil && *u.LineUUID != "":
			u.BindingStatus = "bound"
		case u.GoogleEmail != nil && *u.GoogleEmail != "":
			u.BindingStatus = "password_only"
		default:
			u.BindingStatus = "pending"
		}
		users = append(users, u)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

type createUserRequest struct {
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	ClinicID    string `json:"clinic_id"`
}

type createUserResponse struct {
	UserID     int       `json:"user_id"`
	Token      string    `json:"binding_token"`
	BindingURL string    `json:"binding_url"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// CreateUser：POST /auth/admin/users — 「先建」
// 建立一筆 users row（line_uuid=NULL）並產生 7 天有效 binding token
func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.ClinicID = strings.TrimSpace(req.ClinicID)
	if req.DisplayName == "" {
		http.Error(w, "display_name required", http.StatusBadRequest)
		return
	}
	if !clinicIDRe.MatchString(req.ClinicID) {
		http.Error(w, "clinic_id must match ^[A-Za-z0-9_-]{1,20}$", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = "patient"
	}

	var userID int
	err := h.engine.DB().QueryRow(r.Context(), `
		INSERT INTO users (display_name, role_id, clinic_id, active)
		VALUES ($1, (SELECT id FROM roles WHERE name = $2), $3, true)
		RETURNING id`,
		req.DisplayName, req.Role, req.ClinicID).Scan(&userID)
	if err != nil {
		http.Error(w, "create failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	token, err := generateBindToken()
	if err != nil {
		http.Error(w, "token generation failed", http.StatusInternalServerError)
		return
	}
	if err := h.rdb.Set(r.Context(), "bind:"+token, userID, bindTokenTTL).Err(); err != nil {
		http.Error(w, "token store failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, createUserResponse{
		UserID:     userID,
		Token:      token,
		BindingURL: buildBindingURL(r, token),
		ExpiresAt:  time.Now().Add(bindTokenTTL),
	})
}

// RegenerateBindToken：POST /auth/admin/users/{id}/binding-token
// 給已建立但未綁 LINE 的 user 重新發一張 token
func (h *Handler) RegenerateBindToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var lineUUID *string
	err = h.engine.DB().QueryRow(r.Context(),
		`SELECT line_uuid FROM users WHERE id = $1`, id).Scan(&lineUUID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if lineUUID != nil && *lineUUID != "" {
		http.Error(w, "user already bound to LINE", http.StatusConflict)
		return
	}

	token, err := generateBindToken()
	if err != nil {
		http.Error(w, "token generation failed", http.StatusInternalServerError)
		return
	}
	if err := h.rdb.Set(r.Context(), "bind:"+token, id, bindTokenTTL).Err(); err != nil {
		http.Error(w, "token store failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, createUserResponse{
		UserID:     id,
		Token:      token,
		BindingURL: buildBindingURL(r, token),
		ExpiresAt:  time.Now().Add(bindTokenTTL),
	})
}

type updateUserRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Role        string  `json:"role,omitempty"`
	ClinicID    string  `json:"clinic_id,omitempty"`
	Active      *bool   `json:"active,omitempty"`
}

// UpdateUser：PATCH /auth/admin/users/{id}
func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req updateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	db := h.engine.DB()
	if req.DisplayName != nil {
		if _, err := db.Exec(r.Context(),
			`UPDATE users SET display_name = $1 WHERE id = $2`, *req.DisplayName, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if req.Role != "" {
		if _, err := db.Exec(r.Context(), `
			UPDATE users SET role_id = (SELECT id FROM roles WHERE name = $1)
			WHERE id = $2`, req.Role, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// 角色切換時，staff/nutritionist/admin 不該保留 patient_id
		if req.Role != "patient" {
			_, _ = db.Exec(r.Context(), `UPDATE users SET patient_id = NULL WHERE id = $1`, id)
		}
	}
	if req.ClinicID != "" {
		if !clinicIDRe.MatchString(req.ClinicID) {
			http.Error(w, "clinic_id format invalid", http.StatusBadRequest)
			return
		}
		if _, err := db.Exec(r.Context(),
			`UPDATE users SET clinic_id = $1 WHERE id = $2`, req.ClinicID, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if req.Active != nil {
		if _, err := db.Exec(r.Context(),
			`UPDATE users SET active = $1 WHERE id = $2`, *req.Active, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "id": id})
}

func generateBindToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// buildBindingURL：優先用 LIFF URL（LINE 可直接開），否則 fallback 到相對路徑
// admin 可在前端把這個 URL 丟 QR / 貼訊息給使用者
func buildBindingURL(r *http.Request, token string) string {
	// 若環境有設 LIFF_ID，直接組 liff.line.me URL
	// frontend env（NEXT_PUBLIC_LIFF_ID）比後端更權威，這裡只是方便 admin 拿到立即可用的連結
	// 若 backend 沒設就給相對路徑讓前端 admin UI 自己補 domain
	if liff := os.Getenv("LIFF_ID"); liff != "" {
		return "https://liff.line.me/" + liff + "?token=" + token
	}
	return "/liff?token=" + token
}
