package handler

import (
	"net/http"
	"strconv"
	"strings"

	"auth_service/engine"
	"auth_service/token"
)

func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	// 1. 取 cookie
	cookie, err := r.Cookie("access_token")
	if err != nil {
		http.Error(w, "no token", http.StatusUnauthorized)
		return
	}

	// 2. 解析 JWT
	claims, err := token.Parse(cookie.Value, h.cfg.JWTSecret)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	// 3. 查 blacklist（fix #5: fail-closed）
	revoked, err := token.IsRevoked(r.Context(), h.rdb, claims.ID)
	if err != nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	if revoked {
		http.Error(w, "token revoked", http.StatusUnauthorized)
		return
	}

	// 4. 解析原始請求的 method + URI（fix #2: X-Original-Method）
	method := r.Header.Get("X-Original-Method")
	uri := r.Header.Get("X-Original-URI")
	perm := h.engine.ResolvePermission(method, uri)

	// 5. RBAC + PBAC
	if perm != "" {
		sub := engine.Subject{
			UserID:    claims.UserID,
			Role:      claims.Role,
			ClinicID:  claims.ClinicID,
			PatientID: claims.PatientID,
		}
		res := resolveResource(uri, sub)

		if !h.engine.Check(sub, perm, res) {
			http.Error(w, "permission denied", http.StatusForbidden)
			return
		}
	}

	// 6. 通過，注入 header
	w.Header().Set("X-User-Id", strconv.Itoa(claims.UserID))
	w.Header().Set("X-User-Role", claims.Role)
	w.Header().Set("X-Clinic-Id", claims.ClinicID)
	w.Header().Set("X-Patient-Id", strconv.Itoa(claims.PatientID))
	w.WriteHeader(http.StatusOK)
}

func resolveResource(uri string, sub engine.Subject) engine.Resource {
	res := engine.Resource{ClinicID: sub.ClinicID}
	if strings.Contains(uri, "/patients/") {
		parts := strings.Split(uri, "/")
		for i, p := range parts {
			if p == "patients" && i+1 < len(parts) {
				res.PatientID, _ = strconv.Atoi(parts[i+1])
			}
		}
	} else {
		res.PatientID = sub.PatientID
	}
	return res
}
