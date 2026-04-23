// IntegrationIcon — 各家服務的 mono-line SVG icon，照設計稿（shared.jsx）搬。
// 用在 Integrations 頁的 chip / card，以及未來的 task tag 小標。

export type IntegrationKind = "notion" | "slack" | "teams" | "gcal" | "zoom" | "gmeet";

export function IntegrationIcon({ name, size = 20, color = "currentColor" }: {
  name: IntegrationKind; size?: number; color?: string;
}) {
  const S = size;
  switch (name) {
    case "notion":
      return (
        <svg width={S} height={S} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.6" />
          <path d="M8 8v8M8 8l8 8M16 8v8" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "slack":
      return (
        <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round">
          <rect x="10" y="3"  width="4"  height="10" rx="2" />
          <rect x="10" y="14" width="4"  height="7"  rx="2" />
          <rect x="3"  y="10" width="10" height="4"  rx="2" />
          <rect x="14" y="10" width="7"  height="4"  rx="2" />
        </svg>
      );
    case "teams":
      return (
        <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
          <rect x="3" y="5" width="12" height="14" rx="2" />
          <path d="M9 9v6M6 9h6" strokeLinecap="round" />
          <circle cx="18" cy="10" r="3" />
          <path d="M15 15h6v3a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    case "gcal":
      return (
        <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4" strokeLinecap="round" />
          <text x="12" y="17" fontSize="7" textAnchor="middle" fill={color} stroke="none" fontFamily="monospace" fontWeight="700">31</text>
        </svg>
      );
    case "zoom":
      return (
        <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round">
          <rect x="3" y="7" width="12" height="10" rx="2" />
          <path d="M15 11l6-3v8l-6-3z" />
        </svg>
      );
    case "gmeet":
      return (
        <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round">
          <rect x="3" y="7" width="11" height="10" rx="1.5" />
          <path d="M14 11l7-3v8l-7-3z" />
          <path d="M9 11v2" />
        </svg>
      );
  }
}
