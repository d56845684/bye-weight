// Kuji icon 集 — 1.5px stroke，currentColor。
// 照搬 Kuji Frontend.html 的 KIcon。

export type IconName =
  | "mic" | "stop" | "play" | "pause" | "upload" | "search" | "settings"
  | "users" | "home" | "kanban" | "meeting" | "plus" | "close" | "check"
  | "chevronRight" | "chevronDown" | "chevronLeft" | "filter" | "more"
  | "sparkle" | "bell" | "link" | "clock" | "calendar" | "arrowRight"
  | "arrowUpRight" | "dot" | "folder" | "tag" | "user" | "logout"
  | "waveform" | "card" | "trending" | "alert" | "info" | "shield" | "zap"
  | "edit" | "trash";

export function KIcon({ name, size = 16, color = "currentColor", stroke = 1.5 }: {
  name: IconName; size?: number; color?: string; stroke?: number;
}) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: stroke,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "mic":      return <svg {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>;
    case "stop":     return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="1"/></svg>;
    case "play":     return <svg {...p}><path d="M7 5v14l12-7z"/></svg>;
    case "pause":    return <svg {...p}><path d="M8 5v14M16 5v14"/></svg>;
    case "upload":   return <svg {...p}><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>;
    case "search":   return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>;
    case "settings": return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3h0a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v0a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>;
    case "users":    return <svg {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" transform="translate(3 0)"/><circle cx="12" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>;
    case "home":     return <svg {...p}><path d="M3 10l9-7 9 7v11a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2z"/></svg>;
    case "kanban":   return <svg {...p}><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/></svg>;
    case "meeting":  return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h5M8 17h3"/></svg>;
    case "plus":     return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "close":    return <svg {...p}><path d="M6 6l12 12M6 18L18 6"/></svg>;
    case "check":    return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
    case "chevronRight": return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case "chevronDown":  return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
    case "chevronLeft":  return <svg {...p}><path d="M15 6l-6 6 6 6"/></svg>;
    case "filter":   return <svg {...p}><path d="M3 4h18M6 12h12M10 20h4"/></svg>;
    case "more":     return <svg {...p}><circle cx="5" cy="12" r="1.2" fill={color} stroke="none"/><circle cx="12" cy="12" r="1.2" fill={color} stroke="none"/><circle cx="19" cy="12" r="1.2" fill={color} stroke="none"/></svg>;
    case "sparkle":  return <svg {...p}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 14l.8 2 2 .8-2 .8L19 20l-.8-2-2-.8 2-.8z"/></svg>;
    case "bell":     return <svg {...p}><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0"/></svg>;
    case "link":     return <svg {...p}><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg>;
    case "clock":    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "calendar": return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>;
    case "arrowRight":   return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case "arrowUpRight": return <svg {...p}><path d="M7 17L17 7M8 7h9v9"/></svg>;
    case "dot":      return <svg {...p}><circle cx="12" cy="12" r="3" fill={color}/></svg>;
    case "folder":   return <svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>;
    case "tag":      return <svg {...p}><path d="M3 12l8-8 9 1 1 9-8 8z"/><circle cx="15" cy="9" r="1.2"/></svg>;
    case "user":     return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>;
    case "logout":   return <svg {...p}><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l-5-5 5-5M5 12h12"/></svg>;
    case "waveform": return <svg {...p}><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 12h2"/></svg>;
    case "card":     return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>;
    case "trending": return <svg {...p}><path d="M3 17l6-6 4 4 7-8M15 7h6v6"/></svg>;
    case "alert":    return <svg {...p}><path d="M12 3l10 18H2z"/><path d="M12 9v5M12 18h.01"/></svg>;
    case "info":     return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>;
    case "shield":   return <svg {...p}><path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>;
    case "zap":      return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>;
    case "edit":     return <svg {...p}><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>;
    case "trash":    return <svg {...p}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>;
    default: return null;
  }
}
