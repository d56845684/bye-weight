package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"auth_service/token"
)

const bindTokenTTL = 7 * 24 * time.Hour

type adminUserRow struct {
	ID            int     `json:"id"`
	DisplayName   *string `json:"display_name"`
	LineUUID      *string `json:"line_uuid"`
	GoogleEmail   *string `json:"google_email"`
	Role          string  `json:"role"`
	TenantID      int     `json:"tenant_id"`
	TenantSlug    string  `json:"tenant_slug"`
	Active        bool    `json:"active"`
	BindingStatus string  `json:"binding_status"` // bound / pending / password_only
}

// ListUsers：GET /auth/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.engine.DB().Query(r.Context(), `
		SELECT u.id, u.display_name, u.line_uuid, u.google_email,
		       r.name, u.tenant_id, t.slug, u.active
		FROM users u
		JOIN roles r   ON u.role_id  = r.id
		JOIN tenants t ON u.tenant_id = t.id
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
			&u.Role, &u.TenantID, &u.TenantSlug, &u.Active,
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
	TenantID    int    `json:"tenant_id"`
}

type createUserResponse struct {
	UserID     int       `json:"user_id"`
	Token      string    `json:"binding_token"`
	BindingURL string    `json:"binding_url"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// CreateUser：POST /auth/admin/users
// 建立一筆 users row（line_uuid=NULL）並產生 7 天有效 binding token
func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		http.Error(w, "display_name required", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = "patient"
	}
	// tenant_id=0 只允許綁 super_admin；其他角色必須綁實體 tenant
	if req.Role != "super_admin" && req.TenantID == 0 {
		http.Error(w, "tenant_id is required for non-super_admin roles", http.StatusBadRequest)
		return
	}

	// 驗證 tenant 存在
	var exists bool
	if err := h.engine.DB().QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1 AND active = true)`,
		req.TenantID).Scan(&exists); err != nil {
		http.Error(w, "tenant lookup failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "tenant not found or inactive", http.StatusBadRequest)
		return
	}

	// 驗證 role 是否在 tenant_roles 訂閱中（system tenant 永遠放行）
	if req.TenantID != 0 {
		var roleAvailable bool
		if err := h.engine.DB().QueryRow(r.Context(), `
			SELECT EXISTS (
				SELECT 1 FROM tenant_roles tr
				JOIN roles r ON tr.role_id = r.id
				WHERE tr.tenant_id = $1 AND r.name = $2
			)`, req.TenantID, req.Role).Scan(&roleAvailable); err != nil {
			http.Error(w, "role check failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if !roleAvailable {
			http.Error(w, "role '"+req.Role+"' is not subscribed by this tenant", http.StatusBadRequest)
			return
		}
	}

	var userID int
	err := withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO users (display_name, role_id, tenant_id, active)
			VALUES ($1, (SELECT id FROM roles WHERE name = $2), $3, true)
			RETURNING id`,
			req.DisplayName, req.Role, req.TenantID).Scan(&userID)
	})
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
	TenantID    *int    `json:"tenant_id,omitempty"`
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

	// 驗證（讀取不需進 tx）
	if req.Role != "" {
		var tenantID int
		if err := db.QueryRow(r.Context(),
			`SELECT tenant_id FROM users WHERE id = $1`, id).Scan(&tenantID); err != nil {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}
		if tenantID != 0 {
			var roleAvailable bool
			if err := db.QueryRow(r.Context(), `
				SELECT EXISTS (
					SELECT 1 FROM tenant_roles tr
					JOIN roles r ON tr.role_id = r.id
					WHERE tr.tenant_id = $1 AND r.name = $2
				)`, tenantID, req.Role).Scan(&roleAvailable); err != nil {
				http.Error(w, "role check failed", http.StatusInternalServerError)
				return
			}
			if !roleAvailable {
				http.Error(w, "role '"+req.Role+"' not subscribed by user's tenant",
					http.StatusBadRequest)
				return
			}
		}
	}
	if req.TenantID != nil {
		var ok bool
		if err := db.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1 AND active = true)`,
			*req.TenantID).Scan(&ok); err != nil || !ok {
			http.Error(w, "tenant not found or inactive", http.StatusBadRequest)
			return
		}
	}

	// 全部 UPDATE 在單一 audited tx 中執行
	err = withAudit(r, db, func(tx pgx.Tx) error {
		if req.DisplayName != nil {
			if _, err := tx.Exec(r.Context(),
				`UPDATE users SET display_name = $1 WHERE id = $2`, *req.DisplayName, id); err != nil {
				return err
			}
		}
		if req.Role != "" {
			if _, err := tx.Exec(r.Context(), `
				UPDATE users SET role_id = (SELECT id FROM roles WHERE name = $1)
				WHERE id = $2`, req.Role, id); err != nil {
				return err
			}
		}
		if req.TenantID != nil {
			if _, err := tx.Exec(r.Context(),
				`UPDATE users SET tenant_id = $1 WHERE id = $2`, *req.TenantID, id); err != nil {
				return err
			}
		}
		if req.Active != nil {
			if _, err := tx.Exec(r.Context(),
				`UPDATE users SET active = $1 WHERE id = $2`, *req.Active, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 如果動到會讓 JWT 失真的欄位（role / tenant / active），立刻吊銷既有 session
	if req.Role != "" || req.TenantID != nil || req.Active != nil {
		_ = token.RevokeUser(r.Context(), h.rdb, id, h.cfg.RefreshTokenExpire)
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "id": id})
}

// UnbindUser：POST /auth/admin/users/{id}/unbind
// 同步清 line_uuid 並將 active 設為 false。手機上現有 JWT cookie 下一個 request
// 會被 verify.go 的 active 檢查擋下；要再登入必須由 admin 重發 binding-token。
func (h *Handler) UnbindUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// 先確認 user 存在；不存在時直接回 404 比起跑完 tx 再看影響筆數乾淨
	var exists bool
	if err := h.engine.DB().QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, id).Scan(&exists); err != nil {
		http.Error(w, "lookup failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	err = withAudit(r, h.engine.DB(), func(tx pgx.Tx) error {
		_, execErr := tx.Exec(r.Context(),
			`UPDATE users SET line_uuid = NULL, active = false WHERE id = $1`, id)
		return execErr
	})
	if err != nil {
		http.Error(w, "unbind failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 立刻吊銷該 user 現有所有 session（含 access_token / refresh_token）
	// 即便 active 檢查、line_uuid 被誰改動，existing JWT 下一個 request 就 401。
	_ = token.RevokeUser(r.Context(), h.rdb, id, h.cfg.RefreshTokenExpire)

	writeJSON(w, http.StatusOK, map[string]any{"status": "unbound", "id": id})
}

func generateBindToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// buildBindingURL：優先用 LIFF URL（LINE 可直接開），否則 fallback 到相對路徑
func buildBindingURL(r *http.Request, token string) string {
	if liff := os.Getenv("LIFF_ID"); liff != "" {
		return "https://liff.line.me/" + liff + "?token=" + token
	}
	return "/liff?token=" + token
}
