"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// Phase 1 的粗粒度 permission gating：/auth/v1/me/permissions 回一組 allow 動作
// pattern 陣列，前端用 glob 去比對 <Can action="xxx" />。
// 精細到特定 resource 的授權（「能刪這個 patient 嗎」）仍走「打 API 看 403」。

type PermissionsState = {
  role: string | null;
  tenantId: number | null;
  actions: string[];
  loaded: boolean;
};

const INITIAL: PermissionsState = {
  role: null,
  tenantId: null,
  actions: [],
  loaded: false,
};

const Ctx = createContext<PermissionsState>(INITIAL);

// 把 IAM-style glob pattern 編成 regex。`*` → `.*`，其他字元字面比對。
// 小規模 cache：同一 pattern 通常會被問很多次（nav 各連結 render 時重覆呼叫）。
const reCache = new Map<string, RegExp>();
function compile(pattern: string): RegExp {
  const hit = reCache.get(pattern);
  if (hit) return hit;
  const escaped = pattern
    .split("*")
    .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp("^" + escaped + "$");
  reCache.set(pattern, re);
  return re;
}

function matches(pattern: string, action: string): boolean {
  return compile(pattern).test(action);
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PermissionsState>(INITIAL);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/auth/v1/me/permissions", {
          credentials: "include",
        });
        if (aborted) return;
        if (res.ok) {
          const data = await res.json();
          setState({
            role: data.role ?? null,
            tenantId: typeof data.tenant_id === "number" ? data.tenant_id : null,
            actions: Array.isArray(data.actions) ? data.actions : [],
            loaded: true,
          });
        } else {
          // 未登入 / cookie 失效 → 空陣列，<Can> 自然全部不 render
          setState({ ...INITIAL, loaded: true });
        }
      } catch {
        if (!aborted) setState({ ...INITIAL, loaded: true });
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function usePermissions() {
  return useContext(Ctx);
}

/**
 * useCan(action)：檢查當前 user 是否被允許做某 action。
 * 未載入時回 false（保守），載入後看 actions 有沒任何 pattern 吃下這個 action。
 * 傳 string[] 則是「any of」—— 只要有一個允許就 true。
 */
export function useCan(action: string | string[]): boolean {
  const { actions, loaded } = usePermissions();
  return useMemo(() => {
    if (!loaded) return false;
    const targets = Array.isArray(action) ? action : [action];
    return targets.some((t) => actions.some((p) => matches(p, t)));
  }, [actions, loaded, action]);
}

/** <Can action="..."> — 授權才 render children；否則 render fallback（預設 null）。 */
export function Can({
  action,
  fallback = null,
  children,
}: {
  action: string | string[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return useCan(action) ? <>{children}</> : <>{fallback}</>;
}
