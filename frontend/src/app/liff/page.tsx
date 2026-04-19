"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import liff from "@line/liff";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || "";

const ROLE_HOME: Record<string, string> = {
  patient: "/patient/food-logs",
  staff: "/staff/inbody",
  nutritionist: "/nutritionist/push",
  admin: "/admin/patients",         // clinic-admin：統一後台病患頁
  super_admin: "/admin/tenants",    // 系統管理員：租戶管理
};

// 綁定連結（line-bind 成功）的 patient 若還沒在 main_service 建 profile，
// GET /patients/me 回 404 → 導去 /patient/register 填表；其餘情況走 ROLE_HOME。
// 只有「邀請連結」這個一次性流程會呼叫；fast path / 一般 line-token 不做這件事。
async function resolvePatientHome(nextPath: string | null): Promise<string> {
  try {
    const res = await fetch("/api/v1/patients/me", { credentials: "include" });
    if (res.status === 404) return "/patient/register";
  } catch {
    // ignore；fallback 到正常 ROLE_HOME
  }
  return nextPath ?? "/patient/food-logs";
}

export default function LiffPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center p-6"><p className="text-gray-600">載入中…</p></div>}>
      <LiffInner />
    </Suspense>
  );
}

// safeNext：只接受 `/xxx` 這種 same-origin 相對路徑，避免 open redirect
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function LiffInner() {
  const router = useRouter();
  const params = useSearchParams();
  const bindingToken = params.get("token");
  const nextPath = safeNext(params.get("next"));
  const [status, setStatus] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // Fast path：若已經有有效 JWT cookie，直接導到目標，不再打 LINE
        // （綁定模式例外——binding 一定要走完整流程驗 LINE 身份）
        if (!bindingToken) {
          try {
            const meRes = await fetch("/auth/v1/me", { credentials: "include" });
            if (meRes.ok) {
              const me = await meRes.json();
              const target =
                me.role === "patient"
                  ? await resolvePatientHome(nextPath)
                  : nextPath ?? ROLE_HOME[me.role] ?? "/patient/food-logs";
              router.replace(target);
              return;
            }
          } catch {
            // 忽略，fallback 到完整 LIFF flow
          }
        }

        setStatus("初始化 LINE 登入中…");
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          setStatus("無法取得 LINE access token");
          return;
        }

        const endpoint = bindingToken ? "/auth/v1/line-bind" : "/auth/v1/line-token";
        const body = bindingToken
          ? { access_token: accessToken, binding_token: bindingToken }
          : { access_token: accessToken };

        setStatus(bindingToken ? "綁定中…" : "登入中…");
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const msg = await res.text();
          if (res.status === 401 && !bindingToken) {
            setStatus("尚未完成綁定，請向管理員索取綁定連結。");
            return;
          }
          if (res.status === 410) {
            setStatus("綁定連結已過期，請向管理員重新索取。");
            return;
          }
          if (res.status === 409) {
            setStatus(`綁定衝突：${msg}`);
            return;
          }
          throw new Error(msg || `HTTP ${res.status}`);
        }

        const data = await res.json();
        // role=patient 一律要先檢查 patient profile 有沒有建起來，才決定要去
        // register 還是 ROLE_HOME。這樣「首次綁定時 register 失敗」的 user 下次
        // 再開 LIFF 還會被導回 /patient/register 讓他重試，不會卡在空頁面。
        const target =
          data.role === "patient"
            ? await resolvePatientHome(nextPath)
            : nextPath ?? ROLE_HOME[data.role] ?? "/patient/food-logs";
        router.push(target);
      } catch (e: any) {
        setStatus(`登入失敗：${e.message}`);
      }
    })();
  }, [bindingToken, nextPath, router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {status && <p className="text-center text-gray-600">{status}</p>}
    </div>
  );
}
