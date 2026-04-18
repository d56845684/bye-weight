"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
  const router = useRouter();

  const logout = async () => {
    await fetch("/auth/v1/logout", { method: "POST", credentials: "include" });
    router.push("/admin/login");
  };

  useEffect(() => {
    // 1) 進頁面先 refresh 一次，確保 access token 剛被換新
    silentRefresh();

    // 2) 定期背景 refresh
    const interval = setInterval(silentRefresh, REFRESH_INTERVAL_MS);

    // 3) 頁面重新聚焦（切回分頁、從睡眠喚醒）也觸發 refresh
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
            <Link href="/admin/tenants" className="hover:underline">租戶</Link>
            <Link href="/admin/users" className="hover:underline">使用者</Link>
            <Link href="/admin/roles" className="hover:underline">角色</Link>
          </div>
          <button onClick={logout} className="ml-auto text-xs px-3 py-1 border border-white/40 rounded hover:bg-red-800">
            登出
          </button>
        </div>
      </nav>
      <main className="max-w-5xl mx-auto p-4">{children}</main>
    </div>
  );
}
