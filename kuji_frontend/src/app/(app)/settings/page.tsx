"use client";

import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { SettingsShell } from "@/components/SettingsShell";
import { KCard } from "@/lib/ds/primitives";

// 一般設定 — 語言 / 時區 / 預設 AI 模型 等偏好。MVP 先佔位，真正用 localStorage 維持。
export default function GeneralSettingsPage() {
  const { lang, theme, setTheme, variant, setVariant } = usePrefs();

  return (
    <SettingsShell
      active="general"
      title={lang === "zh" ? "一般設定" : "General"}
      subtitle={lang === "zh" ? "偏好 · 語言 · 主題" : "Preferences · language · theme"}
    >
      <div style={{ padding: 28, maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
        <KCard>
          <Row k={lang === "zh" ? "主題" : "Theme"} v={
            <div style={{ display: "flex", gap: 8 }}>
              <Pill on={theme === "dark"}  onClick={() => setTheme("dark")}>Dark</Pill>
              <Pill on={theme === "light"} onClick={() => setTheme("light")}>Light</Pill>
            </div>
          } />
          <Sep />
          <Row k={lang === "zh" ? "介面 variant" : "Variant"} v={
            <div style={{ display: "flex", gap: 8 }}>
              <Pill on={variant === "A"} onClick={() => setVariant("A")}>A · dense</Pill>
              <Pill on={variant === "B"} onClick={() => setVariant("B")}>B · focus</Pill>
            </div>
          } />
          <Sep />
          <Row k={lang === "zh" ? "時區" : "Timezone"} v={<span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: cssVar.fg2 }}>Asia/Taipei (GMT+8)</span>} />
          <Sep />
          <Row k={lang === "zh" ? "預設 AI 模型" : "Default AI model"} v={<span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: cssVar.fg2 }}>Gemini 2.5 Flash</span>} />
        </KCard>
      </div>
    </SettingsShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13, color: cssVar.fg }}>{k}</span>
      {v}
    </div>
  );
}
function Sep() { return <hr style={{ border: 0, borderTop: `1px solid ${cssVar.line}`, margin: "4px 0" }} />; }
function Pill({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 10px", fontSize: 12,
      background: on ? cssVar.accent : "transparent",
      color: on ? cssVar.accentInk : cssVar.fg2,
      border: `1px solid ${on ? cssVar.accent : cssVar.line2}`,
      borderRadius: 6, cursor: "pointer",
    }}>{children}</button>
  );
}
