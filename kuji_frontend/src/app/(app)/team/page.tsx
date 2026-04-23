"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";
import type { TeamMember } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBtn, KBadge, KAvatar, KCard } from "@/lib/ds/primitives";
import { SettingsShell } from "@/components/SettingsShell";

export default function TeamPage() {
  const { variant, lang } = usePrefs();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAPI<TeamMember[]>("/team/members").then(x => { setMembers(x); setLoading(false); });
  }, []);

  return (
    <SettingsShell
      active="team"
      title={lang === "zh" ? "團隊成員" : "Team"}
      subtitle={lang === "zh" ? `共 ${members.length} 位 · 管理別名讓 AI 更準確地指派` : `${members.length} members · teach AI aliases to improve assignment`}
      topRight={<KBtn primary small icon="plus">{lang === "zh" ? "邀請" : "Invite"}</KBtn>}
    >
      <div style={{ padding: 20 }}>
        {loading ? <div style={{ color: cssVar.fg3 }}>載入中…</div> :
          variant === "A" ? <Table members={members} lang={lang} /> : <Cards members={members} lang={lang} />
        }
      </div>
    </SettingsShell>
  );
}

function Table({ members, lang }: { members: TeamMember[]; lang: "zh" | "en" }) {
  return (
    <KCard pad={0}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 2fr 0.5fr", padding: "10px 16px", borderBottom: `1px solid ${cssVar.line}`, fontFamily: "var(--font-mono, monospace)", fontSize: 10, letterSpacing: 1, color: cssVar.fg3, textTransform: "uppercase" }}>
        <div>{lang === "zh" ? "姓名" : "Name"}</div>
        <div>Email</div>
        <div>{lang === "zh" ? "角色" : "Role"}</div>
        <div>{lang === "zh" ? "別名" : "Aliases"}</div>
        <div></div>
      </div>
      {members.map(m => (
        <div key={m.id} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 2fr 0.5fr", padding: "12px 16px", borderBottom: `1px solid ${cssVar.line}`, fontSize: 13, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <KAvatar name={m.display_name} size={28} />
            <span style={{ fontWeight: 500 }}>{m.display_name}</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: cssVar.fg2 }}>{m.email}</div>
          <div><KBadge tone={m.role_label === "Admin" ? "default" : "neutral"}>{m.role_label}</KBadge></div>
          <div style={{ fontSize: 11, color: cssVar.fg3, fontFamily: "var(--font-mono, monospace)" }}>
            {m.aliases.join(" · ")}
          </div>
          <div style={{ textAlign: "right" }}><KBtn small ghost>···</KBtn></div>
        </div>
      ))}
    </KCard>
  );
}

function Cards({ members, lang }: { members: TeamMember[]; lang: "zh" | "en" }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
      {members.map(m => (
        <KCard key={m.id}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 }}>
            <KAvatar name={m.display_name} size={56} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>{m.display_name}</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3 }}>{m.email}</div>
            <KBadge tone={m.role_label === "Admin" ? "default" : "neutral"}>{m.role_label}</KBadge>
            <div style={{ fontSize: 10.5, color: cssVar.fg3, fontFamily: "var(--font-mono, monospace)", marginTop: 4 }}>
              {m.aliases.slice(0, 4).join(" · ")}
            </div>
          </div>
        </KCard>
      ))}
    </div>
  );
}
