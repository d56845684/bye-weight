package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Subject struct {
	UserID    int
	Role      string
	ClinicID  string
	PatientID int
}

type Resource struct {
	ClinicID  string
	PatientID int
}

type PermissionRoute struct {
	PermissionName string
	URLPattern     string
	HTTPMethod     string
}

type Engine struct {
	db  *pgxpool.Pool
	rdb *redis.Client
	mu  sync.RWMutex

	// 從 DB 載入的快取（每 5 分鐘更新）
	permissionRoutes []PermissionRoute
	rolePerms        map[string]map[string]bool // role -> permission -> bool
	permConditions   map[string][]condition      // permission -> conditions
}

type condition struct {
	ConditionType string
	Operator      string
	Config        map[string]string
}

const cacheKey = "auth:engine:cache"
const cacheTTL = 5 * time.Minute

func New(db *pgxpool.Pool, rdb *redis.Client) *Engine {
	e := &Engine{
		db:             db,
		rdb:            rdb,
		rolePerms:      make(map[string]map[string]bool),
		permConditions: make(map[string][]condition),
	}
	if err := e.loadFromDB(context.Background()); err != nil {
		log.Fatalf("failed to load auth engine data: %v", err)
	}
	go e.refreshLoop()
	return e
}

func (e *Engine) refreshLoop() {
	ticker := time.NewTicker(cacheTTL)
	defer ticker.Stop()
	for range ticker.C {
		if err := e.loadFromDB(context.Background()); err != nil {
			log.Printf("auth engine refresh failed: %v", err)
		}
	}
}

func (e *Engine) loadFromDB(ctx context.Context) error {
	// 嘗試從 Redis 快取讀取
	cached, err := e.rdb.Get(ctx, cacheKey).Result()
	if err == nil && cached != "" {
		return e.loadFromCache(cached)
	}

	// 從 DB 載入權限路由
	routes, err := e.loadPermissionRoutes(ctx)
	if err != nil {
		return fmt.Errorf("load permission routes: %w", err)
	}

	// 從 DB 載入角色-權限映射
	rolePerms, err := e.loadRolePermissions(ctx)
	if err != nil {
		return fmt.Errorf("load role permissions: %w", err)
	}

	// 從 DB 載入策略條件
	permConds, err := e.loadPolicyConditions(ctx)
	if err != nil {
		return fmt.Errorf("load policy conditions: %w", err)
	}

	e.mu.Lock()
	e.permissionRoutes = routes
	e.rolePerms = rolePerms
	e.permConditions = permConds
	e.mu.Unlock()

	// 寫入 Redis 快取
	e.saveToCache(ctx)

	return nil
}

type cacheData struct {
	Routes     []PermissionRoute          `json:"routes"`
	RolePerms  map[string]map[string]bool `json:"role_perms"`
	PermConds  map[string][]condition     `json:"perm_conds"`
}

func (e *Engine) loadFromCache(data string) error {
	var cd cacheData
	if err := json.Unmarshal([]byte(data), &cd); err != nil {
		return err
	}
	e.mu.Lock()
	e.permissionRoutes = cd.Routes
	e.rolePerms = cd.RolePerms
	e.permConditions = cd.PermConds
	e.mu.Unlock()
	return nil
}

func (e *Engine) saveToCache(ctx context.Context) {
	e.mu.RLock()
	cd := cacheData{
		Routes:    e.permissionRoutes,
		RolePerms: e.rolePerms,
		PermConds: e.permConditions,
	}
	e.mu.RUnlock()
	data, err := json.Marshal(cd)
	if err != nil {
		return
	}
	e.rdb.SetEx(ctx, cacheKey, string(data), cacheTTL)
}

func (e *Engine) loadPermissionRoutes(ctx context.Context) ([]PermissionRoute, error) {
	rows, err := e.db.Query(ctx, `
		SELECT name, url_pattern, http_method
		FROM permissions
		WHERE url_pattern IS NOT NULL AND http_method IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var routes []PermissionRoute
	for rows.Next() {
		var r PermissionRoute
		if err := rows.Scan(&r.PermissionName, &r.URLPattern, &r.HTTPMethod); err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	return routes, nil
}

func (e *Engine) loadRolePermissions(ctx context.Context) (map[string]map[string]bool, error) {
	rows, err := e.db.Query(ctx, `
		SELECT r.name, p.name
		FROM role_permissions rp
		JOIN roles r ON rp.role_id = r.id
		JOIN permissions p ON rp.permission_id = p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]map[string]bool)
	for rows.Next() {
		var role, perm string
		if err := rows.Scan(&role, &perm); err != nil {
			return nil, err
		}
		if result[role] == nil {
			result[role] = make(map[string]bool)
		}
		result[role][perm] = true
	}
	return result, nil
}

func (e *Engine) loadPolicyConditions(ctx context.Context) (map[string][]condition, error) {
	rows, err := e.db.Query(ctx, `
		SELECT p.name, pc.condition_type, pc.operator, pc.value_config
		FROM permission_policies pp
		JOIN policies pol ON pp.policy_id = pol.id
		JOIN policy_conditions pc ON pc.policy_id = pol.id
		JOIN permissions p ON pp.permission_id = p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]condition)
	for rows.Next() {
		var permName, condType, op string
		var cfg map[string]string
		if err := rows.Scan(&permName, &condType, &op, &cfg); err != nil {
			return nil, err
		}
		result[permName] = append(result[permName], condition{
			ConditionType: condType,
			Operator:      op,
			Config:        cfg,
		})
	}
	return result, nil
}

// ResolvePermission 從 HTTP method + URI 查找對應的 permission
func (e *Engine) ResolvePermission(method, uri string) string {
	e.mu.RLock()
	defer e.mu.RUnlock()

	for _, r := range e.permissionRoutes {
		if r.HTTPMethod == method && strings.HasPrefix(uri, "/api"+r.URLPattern) {
			return r.PermissionName
		}
	}
	return ""
}

// Check 執行 RBAC + PBAC
func (e *Engine) Check(sub Subject, permission string, res Resource) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()

	// RBAC: 角色是否有此權限
	perms, ok := e.rolePerms[sub.Role]
	if !ok || !perms[permission] {
		return false
	}

	// PBAC: 評估所有策略條件
	conditions, ok := e.permConditions[permission]
	if !ok {
		return true // 沒有額外條件，RBAC 通過即可
	}

	for _, cond := range conditions {
		if !evaluate(cond, sub, res) {
			return false
		}
	}
	return true
}

// DB 回傳底層的 pgxpool，供 handler 做使用者查詢
func (e *Engine) DB() *pgxpool.Pool {
	return e.db
}

func evaluate(cond condition, sub Subject, res Resource) bool {
	switch cond.ConditionType {
	case "resource_owner":
		return res.PatientID == 0 || sub.PatientID == res.PatientID
	case "clinic_scope":
		return sub.ClinicID == res.ClinicID
	case "time_window":
		tz, _ := time.LoadLocation(cond.Config["tz"])
		now := time.Now().In(tz)
		start, _ := time.ParseInLocation("15:04", cond.Config["start"], tz)
		end, _ := time.ParseInLocation("15:04", cond.Config["end"], tz)
		nowMin := now.Hour()*60 + now.Minute()
		startMin := start.Hour()*60 + start.Minute()
		endMin := end.Hour()*60 + end.Minute()
		return nowMin >= startMin && nowMin <= endMin
	}
	return true
}
