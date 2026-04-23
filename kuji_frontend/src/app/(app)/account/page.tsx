"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAPI, logout } from "@/lib/api";
import type { Me } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBtn, KBadge, KCard, KAvatar } from "@/lib/ds/primitives";
import { SettingsShell } from "@/components/SettingsShell";

export default function AccountPage() {
  const { variant, lang } = usePrefs();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => { fetchAPI<Me>("/me").then(setMe); }, []);

  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (!me) return <div style={{ padding: 40, color: cssVar.fg3 }}>載入中…</div>;

  return (
    <SettingsShell
      active="account"
      title={lang === "zh" ? "帳號 · 訂閱" : "Account"}
      subtitle={me.member?.email || ""}
      topRight={<KBtn danger small icon="logout" onClick={doLogout}>{lang === "zh" ? "登出" : "Log out"}</KBtn>}
    >
      <div style={{ padding: 20 }}>
        {variant === "A" ? <AccountA me={me} lang={lang} /> : <AccountB me={me} lang={lang} />}
      </div>
    </SettingsShell>
  );
}

function AccountA({ me, lang }: { me: Me; lang: "zh" | "en" }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Profile */}
      <KCard>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <KAvatar name={me.member?.display_name || "?"} size={48} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{me.member?.display_name}</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: cssVar.fg3 }}>{me.member?.email}</div>
          </div>
          <KBadge tone="default" style={{ marginLeft: "auto" }}>{me.member?.role_label}</KBadge>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label="USER_ID" value={`#${me.user_id}`} />
          <Row label="TENANT_ID" value={`#${me.tenant_id}`} />
          <Row label="ROLE" value={me.role} />
          <Row label={lang === "zh" ? "別名" : "ALIASES"} value={me.member?.aliases.join(" · ") || "—"} />
        </div>
      </KCard>
      {/* Usage */}
      <KCard>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
          {lang === "zh" ? "本月用量" : "USAGE THIS MONTH"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Stat k="meetings" v={me.stats.meetings} />
          <Stat k="tasks"    v={me.stats.tasks} />
          <Stat k="routed"   v={`${me.stats.routed_pct}%`} accent />
        </div>
        <hr style={{ border: 0, borderTop: `1px solid ${cssVar.line}`, margin: "16px 0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <KBadge tone="default">TEAM</KBadge>
          <span style={{ fontSize: 12, color: cssVar.fg2 }}>NT$480 / seat / mo · unlimited mins</span>
        </div>
      </KCard>
    </div>
  );
}

function AccountB({ me, lang }: { me: Me; lang: "zh" | "en" }) {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: 20 }}>
      <KAvatar name={me.member?.display_name || "?"} size={72} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>{me.member?.display_name}</div>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: cssVar.fg3 }}>{me.member?.email}</div>
      </div>
      <div style={{ display: "flex", gap: 24, fontFamily: "var(--font-mono, monospace)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, color: cssVar.fg }}>{me.stats.meetings}</div>
          <div style={{ fontSize: 11, color: cssVar.fg3 }}>meetings</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, color: cssVar.fg }}>{me.stats.tasks}</div>
          <div style={{ fontSize: 11, color: cssVar.fg3 }}>tasks</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, color: cssVar.accent }}>{me.stats.routed_pct}%</div>
          <div style={{ fontSize: 11, color: cssVar.fg3 }}>routed</div>
        </div>
      </div>
      <div style={{
        width: "100%", padding: 14, borderRadius: 10,
        background: cssVar.accentSoft, border: `1px solid ${cssVar.line2}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <KBadge tone="default">TEAM</KBadge>
        <span style={{ fontSize: 12, color: cssVar.fg2 }}>NT$480 / seat / mo · unlimited mins</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1 }}>{label}</span>
      <span style={{ color: cssVar.fg2 }}>{value}</span>
    </div>
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
