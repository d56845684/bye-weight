"use client";

import type { CSSProperties, ReactNode } from "react";
import { cssVar } from "./theme";
import { KIcon, IconName } from "./KIcon";

// 對應 Kuji Frontend.html 的 KBtn / KBadge / KAvatar / KCard / KWave。
// 全部用 CSS 變數（--k-*）消化 theme，避免 JS 傳 theme object 的麻煩。

export function KBtn({ children, primary, ghost, danger, small, full, onClick, style, icon, type = "button", disabled }: {
  children: ReactNode;
  primary?: boolean; ghost?: boolean; danger?: boolean; small?: boolean; full?: boolean;
  onClick?: () => void; style?: CSSProperties; icon?: IconName;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: small ? "6px 12px" : "9px 14px",
    fontSize: small ? 12 : 13, fontWeight: 500,
    borderRadius: 7, cursor: "pointer",
    letterSpacing: -0.1, transition: "all .15s",
    width: full ? "100%" : undefined,
    border: "1px solid transparent",
  };
  const variants: CSSProperties = primary
    ? { background: cssVar.accent, color: cssVar.accentInk, border: `1px solid ${cssVar.accent}` }
    : ghost
    ? { background: "transparent", color: cssVar.fg2 }
    : danger
    ? { background: "transparent", color: cssVar.danger, border: `1px solid ${cssVar.line2}` }
    : { background: "transparent", color: cssVar.fg, border: `1px solid ${cssVar.line2}` };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variants, ...style, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {icon && <KIcon name={icon} size={small ? 13 : 14} />}
      {children}
    </button>
  );
}

export type BadgeTone = "default" | "neutral" | "danger" | "warn" | "ok";
export function KBadge({ children, tone = "default", style }: {
  children: ReactNode; tone?: BadgeTone; style?: CSSProperties;
}) {
  const tones: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
    default: { bg: cssVar.accentSoft,       fg: cssVar.accent, bd: "transparent" },
    neutral: { bg: "transparent",           fg: cssVar.fg2,    bd: cssVar.line2 },
    danger:  { bg: "color-mix(in srgb, var(--k-danger) 13%, transparent)", fg: cssVar.danger, bd: "transparent" },
    warn:    { bg: "color-mix(in srgb, var(--k-warn)   13%, transparent)", fg: cssVar.warn,   bd: "transparent" },
    ok:      { bg: "color-mix(in srgb, var(--k-ok)     13%, transparent)", fg: cssVar.ok,     bd: "transparent" },
  };
  const x = tones[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 4,
      background: x.bg, color: x.fg, border: `1px solid ${x.bd}`,
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase",
      ...style,
    }}>
      {children}
    </span>
  );
}

// 頭像：6 色 palette 輪轉；底色用淺色版本（color-mix 22% alpha），字用原色本身。
// `tone` 如果有傳就當 foreground color，背景自動淺色化。
export function KAvatar({ name, size = 24, tone }: { name?: string; size?: number; tone?: string }) {
  const initials = (name || "?").slice(0, 1);
  const colors = ["#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185"];
  const hash = name ? name.charCodeAt(0) % colors.length : 0;
  const fg = tone || colors[hash];
  const bg = `color-mix(in srgb, ${fg} 22%, transparent)`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: size / 2,
      background: bg, color: fg,
      fontWeight: 600, fontSize: Math.round(size * 0.45),
      fontFamily: "inherit",
    }}>
      {initials}
    </span>
  );
}

export function KCard({ children, style, pad = 20 }: { children: ReactNode; style?: CSSProperties; pad?: number }) {
  return (
    <div style={{
      background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10,
      padding: pad, ...style,
    }}>
      {children}
    </div>
  );
}

// 靜態 waveform（SSR-safe；動畫版在 live record 頁才用）。
export function KWave({ bars = 40, height = 40, color, style }: {
  bars?: number; height?: number; color?: string; style?: CSSProperties;
}) {
  const c = color || cssVar.accent;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height, ...style }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h = Math.max(3, (Math.sin(i * 0.6) * 0.5 + 0.5) * (Math.sin(i * 0.13) * 0.4 + 0.6) * height);
        return (
          <div key={i} style={{ width: 3, height: h, background: c, borderRadius: 2, opacity: 0.6 + 0.4 * (h / height) }} />
        );
      })}
    </div>
  );
}
