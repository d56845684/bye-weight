"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-red-700 text-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <span className="font-bold">金鑽減重 - 管理後台</span>
          <div className="flex gap-4 text-sm">
            <Link href="/admin/users" className="hover:underline">使用者</Link>
            <Link href="/admin/roles" className="hover:underline">角色</Link>
            <Link href="/admin/patients" className="hover:underline">病患</Link>
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
