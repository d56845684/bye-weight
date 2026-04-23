// Kuji 設計系統 theme tokens — 對應 Kuji Frontend.html 的 KUJI_THEME。
// Runtime 透過 <body data-theme="dark|light"> 切換；CSS 變數在 globals.css。

export type KujiTheme = "dark" | "light";
export type KujiVariant = "A" | "B";
export type KujiLang = "zh" | "en";

export const DEFAULT_ACCENT = "#60a5fa";

// 取當前 theme token 的 CSS 變數名（給 inline style 需要動態值時）。
export const cssVar = {
  ink: "var(--k-ink)",
  ink2: "var(--k-ink2)",
  ink3: "var(--k-ink3)",
  surface: "var(--k-surface)",
  line: "var(--k-line)",
  line2: "var(--k-line2)",
  line3: "var(--k-line3)",
  fg: "var(--k-fg)",
  fg2: "var(--k-fg2)",
  fg3: "var(--k-fg3)",
  fg4: "var(--k-fg4)",
  accent: "var(--k-accent)",
  accentSoft: "var(--k-accent-soft)",
  accentSofter: "var(--k-accent-softer)",
  accentInk: "var(--k-accent-ink)",
  danger: "var(--k-danger)",
  warn: "var(--k-warn)",
  ok: "var(--k-ok)",
} as const;
