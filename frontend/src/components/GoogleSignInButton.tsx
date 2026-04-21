"use client";

import { useEffect, useRef } from "react";

// 用 Google Identity Services (GIS) — 官方建議的新流程。
// 前端載入 https://accounts.google.com/gsi/client 後呼叫 google.accounts.id.initialize
// 並 renderButton，user 點擊會回 callback(credential=id_token)，前端 POST 給後端驗簽。

type GISCallback = (res: { credential: string }) => void;

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (cfg: {
            client_id: string;
            callback: GISCallback;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";

function loadGIS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("GIS load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("GIS load failed"));
    document.head.appendChild(s);
  });
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export function GoogleSignInButton({
  onCredential,
  text = "signin_with",
}: {
  onCredential: (credential: string) => void;
  text?: "signin_with" | "continue_with" | "signup_with";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    (async () => {
      try {
        await loadGIS();
        if (cancelled || !ref.current) return;
        window.google?.accounts?.id?.initialize({
          client_id: CLIENT_ID,
          callback: (res) => {
            if (res?.credential) onCredential(res.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        window.google?.accounts?.id?.renderButton(ref.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          logo_alignment: "left",
          width: ref.current.clientWidth || 320,
        });
      } catch {
        // 網路 / 腳本載入失敗；保持空的按鈕區塊，caller 可自行處理
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onCredential, text]);

  if (!CLIENT_ID) {
    return (
      <div className="text-xs text-gray-500 bg-gray-50 rounded p-3 text-center">
        Google SSO 未設定（NEXT_PUBLIC_GOOGLE_CLIENT_ID 為空）
      </div>
    );
  }
  return <div ref={ref} className="flex justify-center w-full" />;
}
