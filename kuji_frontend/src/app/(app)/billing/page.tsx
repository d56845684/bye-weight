"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";
import type { Me } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBadge, KCard, KBtn } from "@/lib/ds/primitives";
import { SettingsShell } from "@/components/SettingsShell";

// 用量 — 本月轉錄分鐘數、任務數、連結數；Plan + next billing date。
export default function BillingPage() {
  const { lang } = usePrefs();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { fetchAPI<Me>("/me").then(setMe); }, []);

  const L = lang === "zh" ? {
    title: "用量", sub: "本月 · 下次扣款 5/30",
    meetings: "會議", tasks: "任務", routed: "已路由",
    plan: "目前方案 · Team", planSub: "NT$480 / seat / mo · 無限分鐘數",
    upgrade: "升級方案",
    history: "歷史帳單",
  } : {
    title: "Usage", sub: "This month · next charge May 30",
    meetings: "Meetings", tasks: "Tasks", routed: "Routed",
    plan: "Current plan · Team", planSub: "NT$480 / seat / mo · unlimited minutes",
    upgrade: "Upgrade",
    history: "Invoice history",
  };

  return (
    <SettingsShell active="billing" title={L.title} subtitle={L.sub}>
      <div style={{ padding: 28, maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
        {me && (
          <KCard>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
              {lang === "zh" ? "本月" : "THIS MONTH"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Stat k={L.meetings} v={me.stats.meetings} />
              <Stat k={L.tasks}    v={me.stats.tasks} />
              <Stat k={L.routed}   v={`${me.stats.routed_pct}%`} accent />
            </div>
          </KCard>
        )}

        <KCard>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <KBadge tone="default">TEAM</KBadge>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{L.plan}</div>
            <KBtn small style={{ marginLeft: "auto" }}>{L.upgrade} →</KBtn>
          </div>
          <div style={{ fontSize: 12.5, color: cssVar.fg3 }}>{L.planSub}</div>
        </KCard>

        <div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            {L.history}
          </div>
          <KCard pad={0}>
            {[
              { date: "2026-04-01", amt: "NT$2,880", items: "6 seats · Team" },
              { date: "2026-03-01", amt: "NT$2,400", items: "5 seats · Team" },
              { date: "2026-02-01", amt: "NT$2,400", items: "5 seats · Team" },
            ].map((row, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1fr 2fr 1fr 80px",
                padding: "12px 16px", borderTop: i === 0 ? "none" : `1px solid ${cssVar.line}`,
                fontSize: 13, alignItems: "center",
              }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: cssVar.fg2 }}>{row.date}</span>
                <span style={{ color: cssVar.fg2 }}>{row.items}</span>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{row.amt}</span>
                <KBadge tone="ok">PAID</KBadge>
              </div>
            ))}
          </KCard>
        </div>
      </div>
    </SettingsShell>
  );
}

function Stat({ k, v, accent }: { k: string; v: number | string; accent?: boolean }) {
  return (
    <div style={{
      background: cssVar.ink3, borderRadius: 8, padding: "10px 12px",
      border: `1px solid ${cssVar.line}`,
    }}>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: cssVar.fg4 }}>{k}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent ? cssVar.accent : cssVar.fg }}>{v}</div>
    </div>
  );
}
