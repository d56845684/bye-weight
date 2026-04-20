"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Can, PermissionsProvider, usePermissions } from "@/lib/permissions";

// 每 10 分鐘 silent refresh；access token TTL 是 1 小時，保留充足 buffer
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

async function silentRefresh() {
  try {
    const res = await fetch("/auth/v1/refresh", {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionsProvider>
      <DashboardInner>{children}</DashboardInner>
    </PermissionsProvider>
  );
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, tenantId, loaded } = usePermissions();

  const logout = async () => {
    await fetch("/auth/v1/logout", { method: "POST", credentials: "include" });
    router.push("/admin/login");
  };

  // PermissionsProvider 載入後若 role=null（401 或未登入）→ 導回登入頁
  useEffect(() => {
    if (loaded && !role) {
      router.push("/admin/login");
    }
  }, [loaded, role, router]);

  // silentRefresh loop 與 visibility 切回時觸發 —— 和 permission fetch 解耦
  useEffect(() => {
    silentRefresh();
    const interval = setInterval(silentRefresh, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") silentRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-red-700 text-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <span className="font-bold">管理後台</span>
          <div className="flex gap-4 text-sm">
            <Can action="admin:tenant:write">
              <Link href="/admin/tenants" className="hover:underline">租戶</Link>
            </Can>
            <Can action="admin:user:read">
              <Link href="/admin/users" className="hover:underline">使用者</Link>
            </Can>
            <Can action="admin:role:write">
              <Link href="/admin/roles" className="hover:underline">角色</Link>
            </Can>
            <Can action="admin:policy:read">
              <Link href="/admin/policies" className="hover:underline">Policy</Link>
            </Can>
            <Can action="admin:action_mapping:read">
              <Link href="/admin/action-mappings" className="hover:underline">Action Mapping</Link>
            </Can>
            <Can action="main:patient:read">
              <Link href="/admin/patients" className="hover:underline">病患</Link>
            </Can>
          </div>
          {role && (
            <span className="ml-auto text-xs opacity-80">
              {role}
              {tenantId !== null && tenantId !== 0 && <span className="ml-1">@ tenant {tenantId}</span>}
            </span>
          )}
          <button onClick={logout} className="text-xs px-3 py-1 border border-white/40 rounded hover:bg-red-800">
            登出
          </button>
        </div>
      </nav>
      <main className="max-w-5xl mx-auto p-4">{children}</main>
    </div>
  );
}
