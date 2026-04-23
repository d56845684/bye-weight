"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { cssVar } from "@/lib/ds/theme";
import { KIcon, IconName } from "@/lib/ds/KIcon";
import { KTopbar } from "@/lib/ds/chrome";
import { usePrefs } from "@/lib/prefs";

// SettingsShell — 包住 /integrations /team /account /billing /general，
// 在 sidebar 右側加二級導覽，對應設計稿的 Settings 子選單。

type ItemKey = "general" | "integrations" | "team" | "account" | "billing";

const NAV: { key: ItemKey; href: string; icon: IconName; zh: string; en: string }[] = [
  { key: "general",      href: "/settings",     icon: "settings", zh: "一般設定",    en: "General" },
  { key: "integrations", href: "/integrations", icon: "link",     zh: "整合",        en: "Integrations" },
  { key: "team",         href: "/team",         icon: "users",    zh: "團隊成員",    en: "Team" },
  { key: "account",      href: "/account",      icon: "user",     zh: "帳號 · 訂閱", en: "Account" },
  { key: "billing",      href: "/billing",      icon: "card",     zh: "用量",        en: "Usage" },
];

export function SettingsShell({ active, title, subtitle, topRight, children }: {
  active: ItemKey;
  title: string;
  subtitle?: string;
  topRight?: ReactNode;
  children: ReactNode;
}) {
  const { lang } = usePrefs();
  const pathname = usePathname() || "";
  return (
    <>
      <KTopbar title={title} subtitle={subtitle} right={topRight} />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px 1fr", minHeight: 0 }}>
        <div style={{
          padding: "20px 14px", borderRight: `1px solid ${cssVar.line}`,
          display: "flex", flexDirection: "column", gap: 2, overflow: "auto",
        }}>
          {NAV.map(it => {
            const isActive = active === it.key || pathname.startsWith(it.href);
            return (
              <Link key={it.key} href={it.href} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 10px", borderRadius: 6,
                background: isActive ? cssVar.ink3 : "transparent",
                color: isActive ? cssVar.fg : cssVar.fg2,
                fontSize: 13, textDecoration: "none",
              }}>
                <KIcon name={it.icon} size={14} color={isActive ? cssVar.accent : cssVar.fg3} />
                {lang === "zh" ? it.zh : it.en}
              </Link>
            );
          })}
        </div>
        <div style={{ overflow: "auto" }}>{children}</div>
      </div>
    </>
  );
}
