"use client";

import { useEffect, useState } from "react";
import { fetchAPI, ApiError } from "@/lib/api";
import type { MeetingSpeaker, TeamMember } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBtn, KBadge, KAvatar } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";

// 重指派 speaker 的彈窗。三種操作 tab：
//   assign — 選 team member（下拉）
//   external — 標為外部 + 填 external_org
//   rename — 只改 display_name
// 對應 PATCH /meetings/{id}/speakers/{speaker_id}
// UX 對齊 ProviderDialog / NewTaskDialog（ModalShell、同色系、primitives 元件）。

type Mode = "assign" | "external" | "rename";

export function SpeakerReassignDialog({
  meetingId, speaker, onClose, onSaved,
}: {
  meetingId: number;
  speaker: MeetingSpeaker;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = usePrefs();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [mode, setMode] = useState<Mode>(
    speaker.auth_user_id ? "assign" : speaker.is_external ? "external" : "rename"
  );
  // 三個 tab 各自的表單狀態
  const [pickUid, setPickUid] = useState<number | "">(speaker.auth_user_id ?? "");
  const [extOrg, setExtOrg] = useState<string>(speaker.external_org ?? "");
  const [extName, setExtName] = useState<string>(speaker.display_name);
  const [renameTo, setRenameTo] = useState<string>(speaker.display_name);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<TeamMember[]>("/team/members").then(setMembers).catch(() => {});
  }, []);

  const L = lang === "zh" ? {
    title: "重指派 Speaker",
    sub: "把 AI 識別的 S1/S2 對到正確的身份。變更會立即反映在逐字稿上。",
    tabAssign: "指派 team member",
    tabExternal: "標為外部",
    tabRename: "僅改顯示名稱",
    pickMember: "選擇成員", pickPh: "— 選擇 —",
    extName: "顯示名稱", extOrg: "組織 / 公司（選填）", extOrgPh: "例：Acme",
    renameTo: "新顯示名稱",
    save: "儲存", cancel: "取消",
    badgeInternal: "Team", badgeExternal: "External",
    matchSource: "AI 匹配來源",
    sourceAlias: "Alias 自動對應", sourceManual: "人工指派", sourceUnknown: "未識別",
  } : {
    title: "Reassign speaker",
    sub: "Map ASR labels (S1/S2...) to the right identity. Changes propagate to transcript immediately.",
    tabAssign: "Assign to member",
    tabExternal: "Mark external",
    tabRename: "Rename only",
    pickMember: "Team member", pickPh: "— pick —",
    extName: "Display name", extOrg: "Organization (optional)", extOrgPh: "e.g. Acme",
    renameTo: "New display name",
    save: "Save", cancel: "Cancel",
    badgeInternal: "Team", badgeExternal: "External",
    matchSource: "Match source",
    sourceAlias: "Alias match", sourceManual: "Manual", sourceUnknown: "Unknown",
  };

  const sourceLabel = {
    alias_match: L.sourceAlias,
    manual_override: L.sourceManual,
    unknown: L.sourceUnknown,
  }[speaker.match_source] ?? speaker.match_source;

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      let body: Record<string, unknown> = {};
      if (mode === "assign") {
        if (pickUid === "") { setErr(L.pickPh); setBusy(false); return; }
        body = { auth_user_id: pickUid };
      } else if (mode === "external") {
        body = { auth_user_id: null, display_name: extName || speaker.display_name, external_org: extOrg || null };
      } else {
        body = { display_name: renameTo || speaker.display_name };
      }
      await fetchAPI(`/meetings/${meetingId}/speakers/${speaker.speaker_id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "save failed");
    } finally { setBusy(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520, background: cssVar.ink2,
          border: `1px solid ${cssVar.line2}`, borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)", color: cssVar.fg,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${cssVar.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <KAvatar name={speaker.display_name} size={38} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{speaker.display_name}</span>
                <KBadge tone={speaker.is_external ? "warn" : "default"}>
                  {speaker.is_external ? L.badgeExternal : L.badgeInternal}
                </KBadge>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg4 }}>
                  {speaker.speaker_id}
                </span>
              </div>
              <div style={{ fontSize: 11, color: cssVar.fg3, marginTop: 2, fontFamily: "var(--font-mono, monospace)" }}>
                {L.matchSource}: {sourceLabel}
                {speaker.match_confidence != null && ` · ${Math.round(speaker.match_confidence * 100)}%`}
                {speaker.external_org && ` · ${speaker.external_org}`}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: cssVar.fg3, lineHeight: 1.5 }}>{L.sub}</div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", padding: "0 22px", borderBottom: `1px solid ${cssVar.line}` }}>
          <Tab active={mode === "assign"}   onClick={() => setMode("assign")}>{L.tabAssign}</Tab>
          <Tab active={mode === "external"} onClick={() => setMode("external")}>{L.tabExternal}</Tab>
          <Tab active={mode === "rename"}   onClick={() => setMode("rename")}>{L.tabRename}</Tab>
        </div>

        {/* Form by mode */}
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "assign" && (
            <div>
              <FieldLabel>{L.pickMember}</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                {members.map(m => (
                  <MemberOption
                    key={m.auth_user_id}
                    m={m}
                    active={pickUid === m.auth_user_id}
                    onPick={() => setPickUid(m.auth_user_id)}
                  />
                ))}
              </div>
            </div>
          )}

          {mode === "external" && (
            <>
              <div>
                <FieldLabel>{L.extName}</FieldLabel>
                <input value={extName} onChange={(e) => setExtName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <FieldLabel>{L.extOrg}</FieldLabel>
                <input value={extOrg} onChange={(e) => setExtOrg(e.target.value)} placeholder={L.extOrgPh} style={inputStyle} />
              </div>
            </>
          )}

          {mode === "rename" && (
            <div>
              <FieldLabel>{L.renameTo}</FieldLabel>
              <input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} autoFocus style={inputStyle} />
            </div>
          )}

          {err && <div style={{ color: cssVar.danger, fontSize: 12 }}>{err}</div>}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 22px", borderTop: `1px solid ${cssVar.line}`,
          display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end",
        }}>
          <KBtn small onClick={onClose} type="button">{L.cancel}</KBtn>
          <KBtn small primary icon="check" onClick={submit} disabled={busy}>
            {busy ? "…" : L.save}
          </KBtn>
        </div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "12px 14px", fontSize: 12.5, fontWeight: 500,
        color: active ? cssVar.fg : cssVar.fg3,
        background: "transparent",
        border: "none",
        borderBottom: active ? `1.5px solid ${cssVar.accent}` : "1.5px solid transparent",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function MemberOption({ m, active, onPick }: { m: TeamMember; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 7,
        background: active ? cssVar.accentSoft : cssVar.ink3,
        border: `1px solid ${active ? cssVar.accent : cssVar.line}`,
        color: cssVar.fg, cursor: "pointer", textAlign: "left",
      }}
    >
      <KAvatar name={m.display_name} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.display_name}</div>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3 }}>
          {m.email} · #{m.auth_user_id}
        </div>
      </div>
      {active && <KIcon name="check" size={14} color={cssVar.accent} />}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3,
      marginBottom: 6,
    }}>{children}</div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  background: cssVar.ink3, border: `1px solid ${cssVar.line2}`, borderRadius: 7,
  fontSize: 13, color: cssVar.fg, outline: "none",
};
