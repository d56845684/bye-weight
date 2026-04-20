package handler

import (
	"context"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

// Batch 5b：admin services / invalidate / action_mappings 全改 huma。
// 都屬於「系統級設定」，比 users / tenants 簡單，集中一檔。

// ===== ListServices：GET /auth/admin/services =====

type ListServicesInput struct{}

type ListServicesOutput struct {
	Body struct {
		Services []serviceRow `json:"services"`
	}
}

func (h *Handler) HumaListServices(ctx context.Context, _ *ListServicesInput) (*ListServicesOutput, error) {
	rows, err := h.engine.DB().Query(ctx,
		`SELECT id, name, prefix FROM services ORDER BY id`)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()
	services := []serviceRow{}
	for rows.Next() {
		var s serviceRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Prefix); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		services = append(services, s)
	}
	out := &ListServicesOutput{}
	out.Body.Services = services
	return out, nil
}

// ===== InvalidateCache：POST /auth/admin/invalidate =====

type InvalidateCacheInput struct{}

type InvalidateCacheOutput struct {
	Body struct {
		Status string `json:"status"`
	}
}

func (h *Handler) HumaInvalidateCache(ctx context.Context, _ *InvalidateCacheInput) (*InvalidateCacheOutput, error) {
	if err := h.engine.Invalidate(ctx); err != nil {
		return nil, huma.Error500InternalServerError("invalidate failed: " + err.Error())
	}
	out := &InvalidateCacheOutput{}
	out.Body.Status = "invalidated"
	return out, nil
}

// ===== Action Mappings CRUD =====

type ListActionMappingsInput struct {
	Service string `query:"service" doc:"可選：只看某一個 service 的 mappings"`
}

type ListActionMappingsOutput struct {
	Body struct {
		Mappings []actionMappingRow `json:"mappings"`
	}
}

func (h *Handler) HumaListActionMappings(ctx context.Context, in *ListActionMappingsInput) (*ListActionMappingsOutput, error) {
	svc := strings.TrimSpace(in.Service)
	query := `
		SELECT am.id, am.service_id, s.name, am.http_method, am.url_pattern,
		       am.action, am.resource_template
		FROM action_mappings am
		JOIN services s ON am.service_id = s.id`
	args := []any{}
	if svc != "" {
		query += ` WHERE s.name = $1`
		args = append(args, svc)
	}
	query += ` ORDER BY s.name, am.url_pattern, am.http_method`

	rows, err := h.engine.DB().Query(ctx, query, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	defer rows.Close()
	items := []actionMappingRow{}
	for rows.Next() {
		var m actionMappingRow
		if err := rows.Scan(&m.ID, &m.ServiceID, &m.ServiceName,
			&m.HTTPMethod, &m.URLPattern, &m.Action, &m.ResourceTemplate); err != nil {
			return nil, huma.Error500InternalServerError(err.Error())
		}
		items = append(items, m)
	}
	out := &ListActionMappingsOutput{}
	out.Body.Mappings = items
	return out, nil
}

type CreateActionMappingInput struct {
	XUserID int `header:"X-User-Id"`
	Body    struct {
		ServiceID        int    `json:"service_id"`
		HTTPMethod       string `json:"http_method"`
		URLPattern       string `json:"url_pattern"`
		Action           string `json:"action"`
		ResourceTemplate string `json:"resource_template"`
	}
}

type CreateActionMappingOutput struct {
	Status int
	Body   struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
}

func (h *Handler) HumaCreateActionMapping(ctx context.Context, in *CreateActionMappingInput) (*CreateActionMappingOutput, error) {
	req := in.Body
	req.HTTPMethod = strings.ToUpper(strings.TrimSpace(req.HTTPMethod))
	req.URLPattern = strings.TrimSpace(req.URLPattern)
	req.Action = strings.TrimSpace(req.Action)
	req.ResourceTemplate = strings.TrimSpace(req.ResourceTemplate)

	if req.ServiceID <= 0 {
		return nil, huma.Error400BadRequest("service_id required")
	}
	if !allowedHTTPMethods[req.HTTPMethod] {
		return nil, huma.Error400BadRequest("http_method must be GET/POST/PUT/PATCH/DELETE")
	}
	if req.URLPattern == "" || req.Action == "" || req.ResourceTemplate == "" {
		return nil, huma.Error400BadRequest("url_pattern, action, resource_template required")
	}

	var id int
	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO action_mappings
				(service_id, http_method, url_pattern, action, resource_template)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id`,
			req.ServiceID, req.HTTPMethod, req.URLPattern,
			req.Action, req.ResourceTemplate).Scan(&id)
	})
	if err != nil {
		return nil, huma.Error409Conflict("create failed: " + err.Error())
	}
	_ = h.engine.Invalidate(ctx)

	out := &CreateActionMappingOutput{Status: 201}
	out.Body.ID = id
	out.Body.Status = "created"
	return out, nil
}

type UpdateActionMappingInput struct {
	XUserID int `header:"X-User-Id"`
	ID      int `path:"id"`
	Body    struct {
		HTTPMethod       *string `json:"http_method,omitempty"`
		URLPattern       *string `json:"url_pattern,omitempty"`
		Action           *string `json:"action,omitempty"`
		ResourceTemplate *string `json:"resource_template,omitempty"`
	}
}

func (h *Handler) HumaUpdateActionMapping(ctx context.Context, in *UpdateActionMappingInput) (*simpleStatusOut, error) {
	sets := []string{}
	args := []any{}
	i := 1
	add := func(col string, val any) {
		sets = append(sets, col+"=$"+strconv.Itoa(i))
		args = append(args, val)
		i++
	}
	if in.Body.HTTPMethod != nil {
		m := strings.ToUpper(strings.TrimSpace(*in.Body.HTTPMethod))
		if !allowedHTTPMethods[m] {
			return nil, huma.Error400BadRequest("http_method invalid")
		}
		add("http_method", m)
	}
	if in.Body.URLPattern != nil {
		if s := strings.TrimSpace(*in.Body.URLPattern); s != "" {
			add("url_pattern", s)
		}
	}
	if in.Body.Action != nil {
		if s := strings.TrimSpace(*in.Body.Action); s != "" {
			add("action", s)
		}
	}
	if in.Body.ResourceTemplate != nil {
		if s := strings.TrimSpace(*in.Body.ResourceTemplate); s != "" {
			add("resource_template", s)
		}
	}
	if len(sets) == 0 {
		return nil, huma.Error400BadRequest("no fields to update")
	}
	args = append(args, in.ID)
	sql := "UPDATE action_mappings SET " + strings.Join(sets, ", ") +
		" WHERE id=$" + strconv.Itoa(i)

	var affected int64
	err := withAuditCtx(ctx, h.engine.DB(), in.XUserID, func(tx pgx.Tx) error {
		res, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return err
		}
		affected = res.RowsAffected()
		return nil
	})
	if err != nil {
		return nil, huma.Error409Conflict("update failed: " + err.Error())
	}
	if affected == 0 {
		return nil, huma.Error404NotFound("action_mapping not found")
	}
	_ = h.engine.Invalidate(ctx)

	out := &simpleStatusOut{}
	out.Body.Status = "updated"
	out.Body.ID = in.ID
	return out, nil
}

type DeleteActionMappingInput struct {
	ID int `path:"id"`
}

func (h *Handler) HumaDeleteActionMapping(ctx context.Context, in *DeleteActionMappingInput) (*simpleStatusOut, error) {
	res, err := h.engine.DB().Exec(ctx,
		`DELETE FROM action_mappings WHERE id = $1`, in.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if res.RowsAffected() == 0 {
		return nil, huma.Error404NotFound("action_mapping not found")
	}
	_ = h.engine.Invalidate(ctx)

	out := &simpleStatusOut{}
	out.Body.Status = "deleted"
	out.Body.ID = in.ID
	return out, nil
}
