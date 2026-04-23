"use client";

import { useEffect, useState } from "react";
import { fetchAPI, ApiError } from "@/lib/api";
import type { MeetingListItem, TeamMember } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBtn } from "@/lib/ds/primitives";

// NewTaskDialog — Board 的「+ 新任務」觸發；也能在 Meeting 詳情頁觸發（帶 meeting_id 預設）。
// POST /tasks，成功後 onCreated 回調（通常是重新拉 list）。

export function NewTaskDialog({
  onClose, onCreated, defaultMeetingId,
}: {
  onClose: () => void;
  onCreated: () => void;
  defaultMeetingId?: number;
}) {
  const { lang } = usePrefs();
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);

  const [title, setTitle] = useState("");
  const [meetingId, setMeetingId] = useState<number | "">(defaultMeetingId ?? "");
  const [ownerId, setOwnerId] = useState<number | "">("");
  const [dueLabel, setDueLabel] = useState("");
  const [tag, setTag] = useState<string>("");
  const [priority, setPriority] = useState<"high" | "med" | "low">("med");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchAPI<MeetingListItem[]>("/meetings"),
      fetchAPI<TeamMember[]>("/team/members"),
    ]).then(([m, t]) => { setMeetings(m); setMembers(t); }).catch(() => {});
  }, []);

  const L = lang === "zh" ? {
    title: "新任務", titleLabel: "任務標題", titlePh: "例：更新 Q2 roadmap deck",
    meeting: "來源會議（選填）", owner: "負責人", due: "期限描述", duePh: "例：週三 / 明天 17:00",
    tag: "路由標籤", priority: "優先度", noMeeting: "— 無 —", pickOne: "— 選擇 —",
    cancel: "取消", create: "建立", required: "請輸入標題",
    P_HIGH: "高", P_MED: "中", P_LOW: "低",
  } : {
    title: "New task", titleLabel: "Title", titlePh: "e.g. Update Q2 roadmap deck",
    meeting: "Source meeting (optional)", owner: "Owner", due: "Due label", duePh: "e.g. Wed / tomorrow 5pm",
    tag: "Route to", priority: "Priority", noMeeting: "— none —", pickOne: "— pick —",
    cancel: "Cancel", create: "Create", required: "Title required",
    P_HIGH: "High", P_MED: "Med", P_LOW: "Low",
  };

  const submit = async () => {
    setErr(null);
    if (!title.trim()) { setErr(L.required); return; }
    setBusy(true);
    try {
      const owner = ownerId !== "" ? members.find(m => m.auth_user_id === ownerId) : undefined;
      await fetchAPI("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          meeting_id: meetingId === "" ? null : Number(meetingId),
          owner_user_id: ownerId === "" ? null : Number(ownerId),
          owner_name: owner?.display_name ?? null,
          due_label: dueLabel || null,
          tag: tag || null,
          priority,
        }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "create failed");
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
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{
          width: "100%", maxWidth: 520, background: cssVar.ink2,
          border: `1px solid ${cssVar.line2}`, borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)", color: cssVar.fg,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${cssVar.line}` }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{L.title}</div>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <FieldLabel>{L.titleLabel}</FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={L.titlePh}
            autoFocus
            style={inputStyle}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <FieldLabel>{L.owner}</FieldLabel>
              <select
                value={ownerId === "" ? "" : String(ownerId)}
                onChange={(e) => setOwnerId(e.target.value === "" ? "" : Number(e.target.value))}
                style={inputStyle}
              >
                <option value="">{L.pickOne}</option>
                {members.map(m => (
                  <option key={m.auth_user_id} value={m.auth_user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{L.due}</FieldLabel>
              <input
                value={dueLabel}
                onChange={(e) => setDueLabel(e.target.value)}
                placeholder={L.duePh}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <FieldLabel>{L.meeting}</FieldLabel>
            <select
              value={meetingId === "" ? "" : String(meetingId)}
              onChange={(e) => setMeetingId(e.target.value === "" ? "" : Number(e.target.value))}
              style={inputStyle}
            >
              <option value="">{L.noMeeting}</option>
              {meetings.map(m => (
                <option key={m.id} value={m.id}>#{m.id} · {m.title}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <FieldLabel>{L.tag}</FieldLabel>
              <select value={tag} onChange={(e) => setTag(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="Notion">Notion</option>
                <option value="Slack">Slack</option>
                <option value="Calendar">Google Calendar</option>
                <option value="Email">Email</option>
                <option value="Teams">Teams</option>
                <option value="GitHub">GitHub</option>
              </select>
            </div>
            <div>
              <FieldLabel>{L.priority}</FieldLabel>
              <div style={{ display: "flex", gap: 6 }}>
                {(["high", "med", "low"] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: 500,
                      background: priority === p ? cssVar.accent : "transparent",
                      color: priority === p ? cssVar.accentInk : cssVar.fg2,
                      border: `1px solid ${priority === p ? cssVar.accent : cssVar.line2}`,
                      borderRadius: 6, cursor: "pointer",
                    }}
                  >
                    {p === "high" ? L.P_HIGH : p === "med" ? L.P_MED : L.P_LOW}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {err && (
            <div style={{ color: cssVar.danger, fontSize: 12 }}>{err}</div>
          )}
        </div>
        <div style={{
          padding: "14px 22px", borderTop: `1px solid ${cssVar.line}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <KBtn small onClick={onClose} type="button">{L.cancel}</KBtn>
          <KBtn small primary icon="plus" type="submit" disabled={busy}>
            {busy ? "…" : L.create}
          </KBtn>
        </div>
      </form>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3,
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  background: cssVar.ink3, border: `1px solid ${cssVar.line2}`, borderRadius: 7,
  fontSize: 13, color: cssVar.fg, outline: "none",
};
