"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

type Me = { user_id: number; role: string; tenant_id: number };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  const logout = async () => {
    await fetch("/auth/v1/logout", { method: "POST", credentials: "include" });
    router.push("/admin/login");
  };

  useEffect(() => {
    silentRefresh();
    // 讀 /me 決定要渲染哪些 nav
    (async () => {
      try {
        const res = await fetch("/auth/v1/me", { credentials: "include" });
        if (res.ok) setMe(await res.json());
        else router.push("/admin/login");
      } catch {
        router.push("/admin/login");
      }
    })();

    const interval = setInterval(silentRefresh, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") silentRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const isSuper = me?.role === "super_admin";
  const canUsers = isSuper || me?.role === "admin";   // 系統級或診所管理員
  const canPatients = !!me && me.role !== "patient";  // 除了 patient 之外都看得到

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-red-700 text-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <span className="font-bold">管理後台</span>
          <div className="flex gap-4 text-sm">
            {isSuper && <Link href="/admin/tenants" className="hover:underline">租戶</Link>}
            {canUsers && <Link href="/admin/users" className="hover:underline">使用者</Link>}
            {isSuper && <Link href="/admin/roles" className="hover:underline">角色</Link>}
            {isSuper && <Link href="/admin/policies" className="hover:underline">Policy</Link>}
            {isSuper && <Link href="/admin/action-mappings" className="hover:underline">Action Mapping</Link>}
            {canPatients && <Link href="/admin/patients" className="hover:underline">病患</Link>}
          </div>
          {me && (
            <span className="ml-auto text-xs opacity-80">
              {me.role}
              {me.tenant_id !== 0 && <span className="ml-1">@ tenant {me.tenant_id}</span>}
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
