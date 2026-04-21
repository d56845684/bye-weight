"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { humaMessage } from "@/lib/api";

// 綁定連結 landing page。admin 透過 /auth/v1/admin/users/{id}/google-binding-token
// 產出 URL，user 在這裡登入 Google 完成綁定。
//
// 流程：
//   1. GoogleSignInButton 回 id_token (credential)
//   2. POST /auth/v1/google-bind { credential, binding_token } → 後端驗 id_token +
//      查 Redis token → INSERT auth_identities (provider=google, subject=sub) → 發 JWT
//   3. 導去 role home（admin → /admin/patients，super_admin → /admin/tenants，
//      一般 staff/nutritionist → /admin/patients）

const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin/tenants",
  admin:       "/admin/patients",
  staff:       "/staff/inbody",
  nutritionist:"/nutritionist/push",
  patient:     "/patient/food-logs",
};

export default function BindGooglePage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-500">載入中…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onCredential = useCallback(async (credential: string) => {
    if (!token) {
      setError("缺少綁定 token");
      return;
    }
    setError(null);
    setStatus("綁定中…");
    try {
      const res = await fetch("/auth/v1/google-bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credential, binding_token: token }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 410) {
          setError("綁定連結已過期，請向管理員重新索取");
          return;
        }
        if (res.status === 409) {
          setError(`綁定衝突：${humaMessage(text)}`);
          return;
        }
        setError(humaMessage(text) || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setDone(true);
      setStatus("");
      setTimeout(() => {
        router.replace(ROLE_HOME[data.role] ?? "/admin/patients");
      }, 1000);
    } catch (e: any) {
      setError(e.message);
    }
  }, [token, router]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-sm w-full text-center">
          <h1 className="text-lg font-bold text-red-700 mb-2">連結無效</h1>
          <p className="text-sm text-gray-600">綁定連結缺少 token 參數，請向管理員重新索取。</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl mb-4">
          ✓
        </div>
        <h1 className="text-xl font-bold mb-1">綁定完成</h1>
        <p className="text-sm text-gray-500">正在前往主頁…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="bg-white rounded-lg shadow-sm p-6 max-w-sm w-full space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold">綁定 Google 帳號</h1>
          <p className="text-sm text-gray-600 mt-2">
            使用 Google 登入以完成帳號綁定。綁定後即可用同一個 Google 帳號登入本系統。
          </p>
        </div>

        <GoogleSignInButton onCredential={onCredential} text="continue_with" />

        {status && <p className="text-xs text-gray-500 text-center">{status}</p>}
        {error && (
          <div className="bg-red-50 text-red-700 text-sm p-3 rounded">{error}</div>
        )}
        <p className="text-xs text-gray-400 text-center pt-2 border-t">
          只有收到此連結的對象可以完成綁定。
        </p>
      </div>
    </div>
  );
}
