"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import liff from "@line/liff";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || "";
const LINE_OA_URL = process.env.NEXT_PUBLIC_LINE_OA_URL || "";

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

// 綁定流程一定要先加 OA 好友，之後 staff 端才能推訊息、發 InBody 提醒。
// 只在綁定流程卡：既有 user 一般登入不檢查（不打擾）。
// 若 LIFF channel 沒綁 OA，getFriendship() 會 reject — 當作「無法驗證」跳過，
// 以免 dev 環境直接被擋死。
async function checkFriendship(): Promise<"friend" | "not-friend" | "unknown"> {
  try {
    const { friendFlag } = await liff.getFriendship();
    return friendFlag ? "friend" : "not-friend";
  } catch {
    return "unknown";
  }
}

function LiffInner() {
  const router = useRouter();
  const params = useSearchParams();
  const bindingToken = params.get("token");
  const nextPath = safeNext(params.get("next"));
  const [status, setStatus] = useState("");
  const [needsFriend, setNeedsFriend] = useState(false);
  const accessTokenRef = useRef<string | null>(null);

  // 綁定：POST /auth/v1/line-bind。後端對「token 已 consume 但同一個 LINE UUID
  // 已綁好」的情境做冪等處理（回 200 接續 session），所以前端不用再自己寫 fallback。
  // 真正完成綁定 = 後續 /patient/register 建好 Patient row（由 resolvePatientHome 導頁）。
  const completeBind = useCallback(async () => {
    const accessToken = accessTokenRef.current;
    if (!accessToken || !bindingToken) return;
    setStatus("綁定中…");
    const res = await fetch("/auth/v1/line-bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ access_token: accessToken, binding_token: bindingToken }),
    });
    if (!res.ok) {
      const msg = await res.text();
      if (res.status === 410) {
        setStatus("綁定連結已過期，請向管理員重新索取。");
        return;
      }
      if (res.status === 409) {
        setStatus(`綁定衝突：${msg}`);
        return;
      }
      setStatus(`綁定失敗：${msg || `HTTP ${res.status}`}`);
      return;
    }
    const data = await res.json();
    const target =
      data.role === "patient"
        ? await resolvePatientHome(nextPath)
        : nextPath ?? ROLE_HOME[data.role] ?? "/patient/food-logs";
    router.push(target);
  }, [bindingToken, nextPath, router]);

  // 點「加入官方帳號」：LINE in-app webview 大多擋 <a target="_blank">，
  // 所以要用 LIFF 官方 API liff.openWindow({ external: true }) 才會真的跳到
  // LINE 的加好友頁（external: true = 離開 LIFF webview 走 LINE 系統 deep link）。
  // 非 LIFF 環境（本機瀏覽器測試）fallback 到 window.open。
  const openOAInLine = useCallback(() => {
    if (!LINE_OA_URL) return;
    try {
      if (typeof liff.isInClient === "function" && liff.isInClient()) {
        liff.openWindow({ url: LINE_OA_URL, external: true });
        return;
      }
    } catch {
      // fall through
    }
    window.open(LINE_OA_URL, "_blank", "noreferrer");
  }, []);

  // 使用者回到頁面點「我已加入官方帳號」時，重查一次 friendship。
  const retryAfterAddFriend = useCallback(async () => {
    setStatus("重新確認好友狀態…");
    const state = await checkFriendship();
    if (state === "friend" || state === "unknown") {
      setNeedsFriend(false);
      await completeBind();
    } else {
      setStatus("仍未偵測到好友狀態；請確認已在 LINE App 點下「加入」。");
    }
  }, [completeBind]);

  // 當 needsFriend=true 時，自動在「分頁/視窗切回」時重查 friendship：
  // 使用者去 LINE 按「加入官方帳號」、加完回來，不用特別點按鈕就能繼續。
  // visibilitychange 覆蓋 in-app browser 切回；focus 覆蓋桌機分頁切換；
  // pageshow 覆蓋 bfcache 還原（iOS Safari 上頁回來常見）。
  useEffect(() => {
    if (!needsFriend) return;
    let running = false;
    const tryProceed = async () => {
      if (running) return;
      if (document.visibilityState !== "visible") return;
      running = true;
      const state = await checkFriendship();
      running = false;
      if (state === "friend") {
        setNeedsFriend(false);
        await completeBind();
      }
      // not-friend / unknown：靜默，不覆蓋畫面訊息，等下次切回或手動按重試
    };
    document.addEventListener("visibilitychange", tryProceed);
    window.addEventListener("focus", tryProceed);
    window.addEventListener("pageshow", tryProceed);
    return () => {
      document.removeEventListener("visibilitychange", tryProceed);
      window.removeEventListener("focus", tryProceed);
      window.removeEventListener("pageshow", tryProceed);
    };
  }, [needsFriend, completeBind]);

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
        accessTokenRef.current = accessToken;

        // 非綁定流程：走舊的 /line-token
        if (!bindingToken) {
          setStatus("登入中…");
          const res = await fetch("/auth/v1/line-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ access_token: accessToken }),
          });
          if (!res.ok) {
            const msg = await res.text();
            if (res.status === 401) {
              setStatus("尚未完成綁定，請向管理員索取綁定連結。");
              return;
            }
            throw new Error(msg || `HTTP ${res.status}`);
          }
          const data = await res.json();
          const target =
            data.role === "patient"
              ? await resolvePatientHome(nextPath)
              : nextPath ?? ROLE_HOME[data.role] ?? "/patient/food-logs";
          router.push(target);
          return;
        }

        // 綁定流程：先確認已加入 OA 好友，才能真正 bind
        setStatus("檢查官方帳號狀態…");
        const state = await checkFriendship();
        if (state === "not-friend") {
          setNeedsFriend(true);
          setStatus("");
          return;
        }
        // friend or unknown（LIFF channel 未綁 OA 的 dev 環境）→ 直接 bind
        await completeBind();
      } catch (e: any) {
        setStatus(`登入失敗：${e.message}`);
      }
    })();
  }, [bindingToken, nextPath, router, completeBind]);

  if (needsFriend) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-gray-50">
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-sm w-full space-y-4">
          <div>
            <h1 className="text-lg font-bold">請先加入官方帳號</h1>
            <p className="text-sm text-gray-600 mt-2">
              為了讓診所能透過 LINE 傳送追蹤提醒、InBody 報告與回覆您的訊息，
              請先加入我們的官方帳號後再完成綁定。
            </p>
          </div>
          {LINE_OA_URL ? (
            <button
              type="button"
              onClick={openOAInLine}
              className="w-full bg-green-600 text-white rounded py-2 text-sm hover:bg-green-700"
            >
              加入官方帳號
            </button>
          ) : (
            <div className="bg-yellow-50 text-yellow-800 text-xs rounded p-3">
              尚未設定官方帳號連結（NEXT_PUBLIC_LINE_OA_URL），
              請聯繫診所管理員。
            </div>
          )}
          <button
            type="button"
            onClick={retryAfterAddFriend}
            className="w-full border rounded py-2 text-sm hover:bg-gray-50"
          >
            我已加入，繼續綁定
          </button>
          {status && <p className="text-xs text-gray-500 text-center">{status}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {status && <p className="text-center text-gray-600">{status}</p>}
    </div>
  );
}
