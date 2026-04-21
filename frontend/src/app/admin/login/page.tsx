"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { humaMessage } from "@/lib/api";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@dev.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const googleSignIn = async (credential: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/auth/v1/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credential }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 401) {
          throw new Error("此 Google 帳號尚未綁定本系統，請向管理員索取綁定連結");
        }
        throw new Error(humaMessage(text) || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.role !== "super_admin" && data.role !== "admin") {
        throw new Error(`此帳號角色為 ${data.role}，無權登入後台`);
      }
      router.push(data.role === "super_admin" ? "/admin/tenants" : "/admin/patients");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/auth/v1/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const text = await res.text();
        // 401 = 帳密錯 / 帳號停用；對使用者只顯示一句話，不要漏是哪個
        if (res.status === 401) throw new Error("帳號或密碼錯誤，或此帳號已停用");
        throw new Error(humaMessage(text) || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.role !== "super_admin" && data.role !== "admin") {
        throw new Error(`此帳號角色為 ${data.role}，無權登入後台`);
      }
      // super_admin → 系統後台；clinic-admin → 診所後台
      router.push(data.role === "super_admin" ? "/admin/tenants" : "/admin/patients");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-md p-8 w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-700">管理後台</h1>
          <p className="text-sm text-gray-500 mt-1">限 super_admin 登入</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">密碼</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded">{error}</div>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-red-700 text-white py-2 rounded hover:bg-red-800 disabled:opacity-50"
        >
          {loading ? "登入中…" : "登入"}
        </button>

        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1 border-t" />
          <span className="text-xs text-gray-400">或</span>
          <div className="flex-1 border-t" />
        </div>

        <GoogleSignInButton onCredential={googleSignIn} />

        <div className="text-xs text-gray-400 text-center pt-2 border-t">
          預設測試帳號：admin@dev.local / admin123（僅開發環境）
        </div>
      </form>
    </div>
  );
}
