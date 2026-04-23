"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authMe, fetchAPI } from "@/lib/api";
import type { Me } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { KSidebar } from "@/lib/ds/chrome";
import { TweaksPanel } from "@/components/TweaksPanel";
import { cssVar } from "@/lib/ds/theme";

// 登入後共用 layout：側欄 + 主區域 + Tweaks。
// 掛載時 call /auth/v1/me 確認仍在登入狀態，不然導 /kuji/login。

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { lang } = usePrefs();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const who = await authMe();
      if (!who) { router.replace("/login"); return; }
      try {
        const kujiMe = await fetchAPI<Me>("/me");
        setMe(kujiMe);
      } catch {
        // 若 /me 掛了，允許 layout 仍 render；頁面自行處理
      }
      setChecking(false);
    })();
  }, [router]);

  if (checking) {
    return <div style={{ padding: 40, textAlign: "center", color: cssVar.fg3 }}>載入中…</div>;
  }

  const userName = me?.member?.display_name ?? (lang === "zh" ? "使用者" : "User");
  const teamLabel = lang === "zh" ? "Acme · Team" : "Acme · Team";

  return (
    <div style={{ display: "flex", height: "100vh", background: cssVar.ink }}>
      <TweaksPanel />
      <KSidebar lang={lang} userName={userName} teamLabel={teamLabel} />
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </main>
    </div>
  );
}
