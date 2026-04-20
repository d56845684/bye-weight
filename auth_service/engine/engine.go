package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"auth_service/model"
)

// Subject 是 request 的主體（來自 JWT claims）。
// 多租戶 Hard isolation：tenant_id=0 保留給 system tenant（super_admin）。
type Subject struct {
	UserID   int
	Role     string
	TenantID int
}

// compiledMapping 是 action_mappings 的編譯形式，附帶 regex 做 URL 比對。
type compiledMapping struct {
	ServiceName      string
	ServicePrefix    string
	HTTPMethod       string
	URLPattern       string
	Regex            *regexp.Regexp
	PathVars         []string
	Action           string
	ResourceTemplate string
}

type Engine struct {
	db  *pgxpool.Pool
	rdb *redis.Client
	mu  sync.RWMutex

	// in-memory 快取（由 Redis 共享持久化，每 5 分鐘刷新）
	mappings       []compiledMapping                 // 依 URL 特異度排序（具體 > 萬用）
	rolePolicies   map[string][]model.PolicyDocument // role → documents
	tenantServices map[int]map[string]bool           // tenantID → serviceName → subscribed
}

const cacheKey = "auth:engine:cache"
const cacheTTL = 5 * time.Minute

func New(db *pgxpool.Pool, rdb *redis.Client) *Engine {
	e := &Engine{
		db:             db,
		rdb:            rdb,
		rolePolicies:   make(map[string][]model.PolicyDocument),
		tenantServices: make(map[int]map[string]bool),
	}
	if err := e.loadFromDB(context.Background()); err != nil {
		log.Fatalf("failed to load auth engine data: %v", err)
	}
	go e.refreshLoop()
	return e
}

func (e *Engine) DB() *pgxpool.Pool { return e.db }

func (e *Engine) refreshLoop() {
	ticker := time.NewTicker(cacheTTL)
	defer ticker.Stop()
	for range ticker.C {
		if err := e.loadFromDB(context.Background()); err != nil {
			log.Printf("auth engine refresh failed: %v", err)
		}
	}
}

// Invalidate 由管理端點呼叫，強制重載 DB 並覆寫 Redis 快取。
func (e *Engine) Invalidate(ctx context.Context) error {
	e.rdb.Del(ctx, cacheKey)
	return e.loadFromDB(ctx)
}

func (e *Engine) loadFromDB(ctx context.Context) error {
	mappings, err := e.loadActionMappings(ctx)
	if err != nil {
		return fmt.Errorf("load action_mappings: %w", err)
	}
	rolePolicies, err := e.loadRolePolicies(ctx)
	if err != nil {
		return fmt.Errorf("load role_policies: %w", err)
	}
	tenantServices, err := e.loadTenantServices(ctx)
	if err != nil {
		return fmt.Errorf("load tenant_services: %w", err)
	}

	e.mu.Lock()
	e.mappings = mappings
	e.rolePolicies = rolePolicies
	e.tenantServices = tenantServices
	e.mu.Unlock()

	// 寫入 Redis 快取（best-effort）
	e.saveToCache(ctx)
	return nil
}

type cacheData struct {
	Mappings       []cachedMapping                   `json:"mappings"`
	RolePolicies   map[string][]model.PolicyDocument `json:"role_policies"`
	TenantServices map[int]map[string]bool           `json:"tenant_services"`
}

type cachedMapping struct {
	ServiceName      string   `json:"service_name"`
	ServicePrefix    string   `json:"service_prefix"`
	HTTPMethod       string   `json:"http_method"`
	URLPattern       string   `json:"url_pattern"`
	PathVars         []string `json:"path_vars"`
	Action           string   `json:"action"`
	ResourceTemplate string   `json:"resource_template"`
}

func (e *Engine) saveToCache(ctx context.Context) {
	e.mu.RLock()
	cd := cacheData{
		RolePolicies:   e.rolePolicies,
		TenantServices: e.tenantServices,
	}
	for _, m := range e.mappings {
		cd.Mappings = append(cd.Mappings, cachedMapping{
			ServiceName:      m.ServiceName,
			ServicePrefix:    m.ServicePrefix,
			HTTPMethod:       m.HTTPMethod,
			URLPattern:       m.URLPattern,
			PathVars:         m.PathVars,
			Action:           m.Action,
			ResourceTemplate: m.ResourceTemplate,
		})
	}
	e.mu.RUnlock()
	data, err := json.Marshal(cd)
	if err != nil {
		return
	}
	e.rdb.SetEx(ctx, cacheKey, string(data), cacheTTL)
}

func (e *Engine) loadActionMappings(ctx context.Context) ([]compiledMapping, error) {
	rows, err := e.db.Query(ctx, `
		SELECT s.name, s.prefix, am.http_method, am.url_pattern, am.action, am.resource_template
		FROM action_mappings am
		JOIN services s ON am.service_id = s.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []compiledMapping
	for rows.Next() {
		var m compiledMapping
		if err := rows.Scan(&m.ServiceName, &m.ServicePrefix, &m.HTTPMethod,
			&m.URLPattern, &m.Action, &m.ResourceTemplate); err != nil {
			return nil, err
		}
		m.Regex, m.PathVars = compileURLPattern(m.ServicePrefix, m.URLPattern)
		result = append(result, m)
	}

	// 依「具體度」排序：字面段數多者優先（避免 /visits 搶到 /visits/{id}/medications）
	sort.SliceStable(result, func(i, j int) bool {
		return specificity(result[i].URLPattern) > specificity(result[j].URLPattern)
	})
	return result, nil
}

func (e *Engine) loadTenantServices(ctx context.Context) (map[int]map[string]bool, error) {
	rows, err := e.db.Query(ctx, `
		SELECT ts.tenant_id, s.name
		FROM tenant_services ts
		JOIN services s ON ts.service_id = s.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int]map[string]bool)
	for rows.Next() {
		var tenantID int
		var name string
		if err := rows.Scan(&tenantID, &name); err != nil {
			return nil, err
		}
		if result[tenantID] == nil {
			result[tenantID] = make(map[string]bool)
		}
		result[tenantID][name] = true
	}
	return result, nil
}

// IsServiceEnabled 檢查 tenant 是否訂閱該 service。system tenant (id=0) 永遠視為全訂。
func (e *Engine) IsServiceEnabled(tenantID int, serviceName string) bool {
	if tenantID == 0 {
		return true
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	services := e.tenantServices[tenantID]
	if services == nil {
		return false
	}
	return services[serviceName]
}

func (e *Engine) loadRolePolicies(ctx context.Context) (map[string][]model.PolicyDocument, error) {
	rows, err := e.db.Query(ctx, `
		SELECT r.name, p.document
		FROM role_policies rp
		JOIN roles r    ON rp.role_id   = r.id
		JOIN policies p ON rp.policy_id = p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]model.PolicyDocument)
	for rows.Next() {
		var role string
		var raw []byte
		if err := rows.Scan(&role, &raw); err != nil {
			return nil, err
		}
		var doc model.PolicyDocument
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, fmt.Errorf("policy document parse: %w", err)
		}
		result[role] = append(result[role], doc)
	}
	return result, nil
}

// ResolveAction：從 HTTP method + URI 查出對應的 action、resource template、path 變數與 service 名稱。
// 找不到對應規則時 ok=false；verify handler 應拒絕（implicit deny）。
func (e *Engine) ResolveAction(method, uri string) (action, resourceTemplate string, pathAttrs map[string]string, serviceName string, ok bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	// 去掉 query string
	if i := strings.Index(uri, "?"); i >= 0 {
		uri = uri[:i]
	}

	for _, m := range e.mappings {
		if m.HTTPMethod != method {
			continue
		}
		matches := m.Regex.FindStringSubmatch(uri)
		if matches == nil {
			continue
		}
		attrs := make(map[string]string, len(m.PathVars))
		for i, name := range m.PathVars {
			attrs[name] = matches[i+1]
		}
		return m.Action, m.ResourceTemplate, attrs, m.ServiceName, true
	}
	return "", "", nil, "", false
}

// Check：用 AWS IAM-style 評估。Explicit deny > allow > implicit deny。
// action 與 resource 已是具體字串（caller 應先用 SubstituteResource 把 ${auth:*}/${path.*} 展開）。
func (e *Engine) Check(sub Subject, action, resource string) bool {
	e.mu.RLock()
	policies := e.rolePolicies[sub.Role]
	e.mu.RUnlock()

	authSubs := authSubstitutions(sub)

	var hasAllow bool
	for _, doc := range policies {
		for _, stmt := range doc.Statements {
			if !matchAny(action, stmt.Actions, nil) {
				continue
			}
			if !matchAny(resource, stmt.Resources, authSubs) {
				continue
			}
			switch strings.ToLower(stmt.Effect) {
			case "deny":
				return false // explicit deny 直接拒絕
			case "allow":
				hasAllow = true
			}
		}
	}
	return hasAllow
}

// ResolveActionsForSubject 回傳該 subject 在當前 role 的所有 allow 動作（flat、
// 去重、排序）。供 /me/permissions 給前端做 <Can> UI gating 用；純讀 in-memory
// 快取，不打 DB，~μs 級。
//
// **只收 effect=allow**，deny 語句被刻意忽略：UI 是 approximation，
// 真正 deny 由 API 層 (engine.Check) 擋；「顯示了不該顯示的按鈕，按下去 403 →
// redirect /forbidden」是可接受的 degrade，不值得把 glob-vs-glob 減法帶進前端。
func (e *Engine) ResolveActionsForSubject(sub Subject) []string {
	e.mu.RLock()
	policies := e.rolePolicies[sub.Role]
	e.mu.RUnlock()

	seen := make(map[string]struct{})
	for _, doc := range policies {
		for _, stmt := range doc.Statements {
			if strings.ToLower(stmt.Effect) != "allow" {
				continue
			}
			for _, act := range stmt.Actions {
				seen[act] = struct{}{}
			}
		}
	}
	out := make([]string, 0, len(seen))
	for act := range seen {
		out = append(out, act)
	}
	sort.Strings(out)
	return out
}

// SubstituteResource 把 resource_template 中的 ${auth:*}/${path.*} 展開為具體 ARN。
func SubstituteResource(template string, sub Subject, pathAttrs map[string]string) string {
	subs := authSubstitutions(sub)
	for k, v := range pathAttrs {
		subs["${path."+k+"}"] = v
	}
	return applySubs(template, subs)
}

func authSubstitutions(sub Subject) map[string]string {
	return map[string]string{
		"${auth:user_id}":   strconv.Itoa(sub.UserID),
		"${auth:tenant_id}": strconv.Itoa(sub.TenantID),
		"${auth:role}":      sub.Role,
	}
}

func applySubs(s string, subs map[string]string) string {
	for k, v := range subs {
		s = strings.ReplaceAll(s, k, v)
	}
	return s
}

func matchAny(s string, patterns []string, subs map[string]string) bool {
	for _, p := range patterns {
		if subs != nil {
			p = applySubs(p, subs)
		}
		if globMatch(p, s) {
			return true
		}
	}
	return false
}

// globMatch：* 可匹配任意字元（含 /），跟 AWS IAM 同義。
func globMatch(pattern, s string) bool {
	var b strings.Builder
	b.WriteString("^")
	for _, ch := range pattern {
		if ch == '*' {
			b.WriteString(".*")
			continue
		}
		b.WriteString(regexp.QuoteMeta(string(ch)))
	}
	b.WriteString("$")
	re, err := regexp.Compile(b.String())
	if err != nil {
		return false
	}
	return re.MatchString(s)
}

var pathVarRe = regexp.MustCompile(`\{([a-zA-Z_][a-zA-Z0-9_]*)\}`)

// compileURLPattern 將 "/visits/{id}/medications" 或 "/admin/*" 編譯成 regex + 變數名列表。
// prefix 來自 services.prefix（例如 "/api"），組合成完整路徑比對。
// 支援：
//   - {name}  單段變數：([^/]+)
//   - /*      尾端萬用：match 任意後續路徑（含子路徑）
func compileURLPattern(prefix, pattern string) (*regexp.Regexp, []string) {
	full := prefix + pattern
	vars := []string{}
	replaced := pathVarRe.ReplaceAllStringFunc(full, func(m string) string {
		sub := pathVarRe.FindStringSubmatch(m)
		vars = append(vars, sub[1])
		return "([^/]+)"
	})
	if strings.HasSuffix(replaced, "/*") {
		replaced = strings.TrimSuffix(replaced, "/*") + "(/.*)?"
	}
	return regexp.MustCompile("^" + replaced + "$"), vars
}

// specificity：字面段數 × 10 + 模式長度，讓更具體的 URL pattern 排前面。
func specificity(pattern string) int {
	segments := strings.Split(strings.TrimPrefix(pattern, "/"), "/")
	literal := 0
	for _, seg := range segments {
		if !strings.HasPrefix(seg, "{") {
			literal++
		}
	}
	return literal*10 + len(pattern)
}
