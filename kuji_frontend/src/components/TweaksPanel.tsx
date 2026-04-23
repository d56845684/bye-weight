"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KIcon } from "@/lib/ds/KIcon";

// 右下角 Tweaks 面板：Theme / Variant / Language 切換。
// 只有 dev 環境顯示（NEXT_PUBLIC_KUJI_DEV=1），正式環境自動隱藏避免使用者看到。

const IS_DEV = process.env.NEXT_PUBLIC_KUJI_DEV === "1";

export function TweaksPanel() {
  const { theme, variant, lang, setTheme, setVariant, setLang } = usePrefs();
  const [open, setOpen] = useState(false);

  if (!IS_DEV) return null;

  return (
    <div style={{ position: "fixed", bottom: 14, right: 14, zIndex: 50 }}>
      {open && (
        <div style={{
          position: "absolute", bottom: 42, right: 0, width: 240,
          background: cssVar.ink2, border: `1px solid ${cssVar.line2}`, borderRadius: 10,
          padding: 14, boxShadow: "0 10px 30px rgba(0,0,0,.4)",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <Row label="Theme">
            <Pill active={theme === "dark"}  onClick={() => setTheme("dark")}>Dark</Pill>
            <Pill active={theme === "light"} onClick={() => setTheme("light")}>Light</Pill>
          </Row>
          <Row label="Variant">
            <Pill active={variant === "A"} onClick={() => setVariant("A")}>A · dense</Pill>
            <Pill active={variant === "B"} onClick={() => setVariant("B")}>B · focus</Pill>
          </Row>
          <Row label="Language">
            <Pill active={lang === "zh"} onClick={() => setLang("zh")}>中文</Pill>
            <Pill active={lang === "en"} onClick={() => setLang("en")}>English</Pill>
          </Row>
          <div style={{
            fontFamily: "var(--font-mono, monospace)", fontSize: 9,
            color: cssVar.fg4, letterSpacing: 1, textAlign: "center", paddingTop: 4, borderTop: `1px solid ${cssVar.line}`,
          }}>
            DEV ONLY · NEXT_PUBLIC_KUJI_DEV
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(v => !v)}
        title="Dev tweaks"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: cssVar.ink2, border: `1px solid ${cssVar.line2}`, color: cssVar.fg,
          borderRadius: 8, padding: "7px 11px", cursor: "pointer",
          fontSize: 12, fontWeight: 500,
          boxShadow: "0 4px 14px rgba(0,0,0,.3)",
        }}
      >
        <KIcon name="sparkle" size={13} color={cssVar.accent} />
        Tweaks
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--font-mono, monospace)", fontSize: 10,
        color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6,
      }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>{children}</div>
    </div>
  );
}

function Pill({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "6px 10px", borderRadius: 6,
        fontSize: 12, fontWeight: 500,
        background: active ? cssVar.accent : "transparent",
        color: active ? cssVar.accentInk : cssVar.fg2,
        border: `1px solid ${active ? cssVar.accent : cssVar.line2}`,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
