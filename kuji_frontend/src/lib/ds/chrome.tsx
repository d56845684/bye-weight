"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { cssVar } from "./theme";
import { KIcon, IconName } from "./KIcon";
import { KAvatar } from "./primitives";
import { logout } from "@/lib/api";

type NavItem = { k: string; href: string; icon: IconName; label: string; badge?: string };

export function KSidebar({ lang = "zh", userName = "林怡君", teamLabel = "Acme · Team" }: {
  lang?: "zh" | "en"; userName?: string; teamLabel?: string;
}) {
  const router = useRouter();
  const L = lang === "zh" ? {
    board: "行動事項", meetings: "會議", record: "即時錄音", upload: "上傳", inbox: "通知提醒",
    integrations: "整合", team: "團隊", account: "帳號", search: "搜尋…", settings: "設定",
    logout: "登出",
  } : {
    board: "Action Board", meetings: "Meetings", record: "Record", upload: "Upload", inbox: "Notifications",
    integrations: "Integrations", team: "Team", account: "Account", search: "Search…", settings: "Settings",
    logout: "Log out",
  };
  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };
  // basePath="/kuji" 會自動加前綴，href 用相對路徑即可。
  // 注意：usePathname() 回傳的是含 basePath 的實際路徑（/kuji/...），
  // 所以 active 比對時要補回 /kuji/ 前綴。
  const items: NavItem[] = [
    { k: "board",    href: "/board",    icon: "kanban",  label: L.board, badge: "7" },
    { k: "meetings", href: "/meetings", icon: "meeting", label: L.meetings },
    { k: "record",   href: "/record",   icon: "mic",     label: L.record },
    { k: "upload",   href: "/upload",   icon: "upload",  label: L.upload },
    { k: "inbox",    href: "/inbox", icon: "bell", label: L.inbox, badge: "3" },
  ];
  const settings: NavItem[] = [
    { k: "integrations", href: "/integrations", icon: "link",  label: L.integrations },
    { k: "team",         href: "/team",         icon: "users", label: L.team },
    { k: "account",      href: "/account",      icon: "user",  label: L.account },
  ];
  return (
    <aside style={{
      width: 232, flex: "none", background: cssVar.ink, borderRight: `1px solid ${cssVar.line}`,
      display: "flex", flexDirection: "column", color: cssVar.fg,
    }}>
      <div style={{ padding: "18px 16px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: -0.2 }}>{lang === "zh" ? "酷記 Kuji" : "Kuji"}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg4 }}>⌘K</span>
      </div>
      <div style={{ padding: "4px 10px 10px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
          background: cssVar.ink3, border: `1px solid ${cssVar.line}`, borderRadius: 7,
          fontSize: 12, color: cssVar.fg3,
        }}>
          <KIcon name="search" size={13} />{L.search}
        </div>
      </div>
      <nav style={{ padding: "4px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {items.map(it => <SBItem key={it.k} it={it} />)}
      </nav>
      <div style={{ padding: "14px 16px 6px", fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg4, letterSpacing: 1, textTransform: "uppercase" }}>
        {L.settings}
      </div>
      <nav style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {settings.map(it => <SBItem key={it.k} it={it} />)}
      </nav>
      <div style={{ flex: 1 }} />
      {/* 登出按鈕 */}
      <button
        onClick={doLogout}
        title={L.logout}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", margin: "0 8px 6px",
          borderRadius: 6, background: "transparent", border: "none",
          color: cssVar.fg3, fontSize: 12.5, cursor: "pointer",
          textAlign: "left",
        }}
      >
        <KIcon name="logout" size={14} color={cssVar.fg3} />
        <span>{L.logout}</span>
      </button>
      {/* 點頭像 / 姓名區塊進個人設定 */}
      <Link href="/account" style={{
        padding: 12, borderTop: `1px solid ${cssVar.line}`,
        display: "flex", alignItems: "center", gap: 10,
        textDecoration: "none", color: cssVar.fg,
      }}>
        <KAvatar name={userName} size={28} tone="#60a5fa" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{userName}</div>
          <div style={{ fontSize: 11, color: cssVar.fg3, fontFamily: "var(--font-mono, monospace)" }}>{teamLabel}</div>
        </div>
        <KIcon name="chevronRight" size={14} color={cssVar.fg3} />
      </Link>
    </aside>
  );
}

function SBItem({ it }: { it: NavItem }) {
  const pathname = usePathname() || "";
  // usePathname() 回傳「不含 basePath」(/board / /meetings…)；href 也已改相對
  const active = pathname === it.href || (it.href !== "/board" && pathname.startsWith(it.href));
  const style: CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "7px 10px",
    borderRadius: 6, textDecoration: "none",
    background: active ? cssVar.ink3 : "transparent",
    color: active ? cssVar.fg : cssVar.fg2,
    fontSize: 13, fontWeight: active ? 500 : 400,
  };
  return (
    <Link href={it.href} style={style}>
      <KIcon name={it.icon} size={15} color={active ? cssVar.accent : cssVar.fg3} />
      <span style={{ flex: 1 }}>{it.label}</span>
      {it.badge && (
        <span style={{
          fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3,
          padding: "1px 5px", borderRadius: 3, background: cssVar.ink3,
        }}>{it.badge}</span>
      )}
    </Link>
  );
}

export function KTopbar({ title, subtitle, right, backHref }: {
  title: string; subtitle?: string; right?: ReactNode;
  backHref?: string;   // 有值就在 title 前加返回按鈕，點下去回該 href
}) {
  return (
    <div style={{
      height: 56, flex: "none", padding: "0 20px",
      display: "flex", alignItems: "center", gap: 12,
      borderBottom: `1px solid ${cssVar.line}`, background: cssVar.ink,
    }}>
      {backHref && (
        <Link
          href={backHref}
          aria-label="back"
          style={{
            width: 28, height: 28, borderRadius: 6,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: cssVar.fg2, textDecoration: "none",
            border: `1px solid ${cssVar.line2}`,
          }}
        >
          <KIcon name="chevronLeft" size={14} />
        </Link>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: cssVar.fg, letterSpacing: -0.1 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: cssVar.fg3, fontFamily: "var(--font-mono, monospace)", marginTop: 1 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
