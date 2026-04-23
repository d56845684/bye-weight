"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchAPI } from "@/lib/api";
import type { MeetingDetail, MeetingSpeaker } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBadge, KBtn, KAvatar, KCard } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { SpeakerReassignDialog } from "@/components/SpeakerReassignDialog";

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { variant, lang } = usePrefs();
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [anchorMs, setAnchorMs] = useState<number | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<MeetingSpeaker | null>(null);

  const reload = () => fetchAPI<MeetingDetail>(`/meetings/${id}`).then(setM);
  useEffect(() => { reload(); }, [id]);

  useEffect(() => {
    if (typeof window === "undefined" || !m) return;
    const match = window.location.hash.match(/^#t(\d+)$/);
    if (!match) return;
    const ms = Number(match[1]);
    setAnchorMs(ms);
    // 等畫面渲染完後 scroll 到該 segment
    const el = document.querySelector(`[data-segment-ms="${ms}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // 5 秒後卸下 highlight，避免永遠亮著
    const timer = setTimeout(() => setAnchorMs(null), 5000);
    return () => clearTimeout(timer);
  }, [m]);

  if (!m) return <div style={{ padding: 40, color: cssVar.fg3 }}>載入中…</div>;

  return (
    <>
      <KTopbar
        backHref="/meetings"
        title={m.title}
        subtitle={`${m.scheduled_at?.slice(0, 16)} · ${m.speaker_count} speakers · ${m.tasks.length} tasks`}
        right={<>
          <KBtn icon="edit" small>{lang === "zh" ? "編輯" : "Edit"}</KBtn>
          <KBtn icon="arrowUpRight" primary small style={{ marginLeft: 8 }}>{lang === "zh" ? "分享" : "Share"}</KBtn>
        </>}
      />
      <div style={{ flex: 1, overflow: "auto" }}>
        {variant === "A"
          ? <DetailA m={m} lang={lang} anchorMs={anchorMs} onEditSpeaker={setEditingSpeaker} />
          : <DetailB m={m} lang={lang} anchorMs={anchorMs} onEditSpeaker={setEditingSpeaker} />
        }
      </div>

      {editingSpeaker && (
        <SpeakerReassignDialog
          meetingId={m.id}
          speaker={editingSpeaker}
          onClose={() => setEditingSpeaker(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}

// Variant A: split transcript + right rail summary/tasks
function DetailA({ m, lang, anchorMs, onEditSpeaker }: {
  m: MeetingDetail; lang: "zh" | "en"; anchorMs: number | null;
  onEditSpeaker: (sp: MeetingSpeaker) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", height: "100%" }}>
      <div style={{ overflowY: "auto", padding: 20, borderRight: `1px solid ${cssVar.line}` }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
          TRANSCRIPT · {m.transcript.length} segments
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {m.transcript.map(seg => <TranscriptRow key={seg.id} seg={seg} anchored={anchorMs === seg.start_ms} />)}
          {m.transcript.length === 0 && <div style={{ color: cssVar.fg4, fontSize: 12 }}>
            {lang === "zh" ? "（尚無逐字稿）" : "(no transcript yet)"}
          </div>}
        </div>
      </div>
      <div style={{ overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {m.summary && (
          <KCard pad={16}>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.accent, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
              AI Summary
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: cssVar.fg2 }}>{m.summary}</div>
          </KCard>
        )}
        <SpeakersBlock speakers={m.speakers} lang={lang} onEdit={onEditSpeaker} />
        <div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            {lang === "zh" ? `行動事項 · ${m.tasks.length}` : `Action Items · ${m.tasks.length}`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {m.tasks.map(t => <MiniTask key={t.id} task={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// Variant B: chaptered single column (magazine-ish)
function DetailB({ m, lang, anchorMs, onEditSpeaker }: {
  m: MeetingDetail; lang: "zh" | "en"; anchorMs: number | null;
  onEditSpeaker: (sp: MeetingSpeaker) => void;
}) {
  return (
    <div style={{ padding: "28px 40px", maxWidth: 800, margin: "0 auto" }}>
      {m.summary && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
            Summary
          </div>
          <div style={{ fontSize: 18, lineHeight: 1.6, color: cssVar.fg, fontWeight: 500, letterSpacing: -0.2 }}>
            {m.summary}
          </div>
        </div>
      )}
      <SpeakersBlock speakers={m.speakers} lang={lang} onEdit={onEditSpeaker} magazine />
      <hr style={{ border: 0, borderTop: `1px solid ${cssVar.line}`, margin: "24px 0" }} />
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
        Transcript
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {m.transcript.map(seg => <TranscriptRow key={seg.id} seg={seg} magazine anchored={anchorMs === seg.start_ms} />)}
      </div>
      <hr style={{ border: 0, borderTop: `1px solid ${cssVar.line}`, margin: "24px 0" }} />
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
        Action Items · {m.tasks.length}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {m.tasks.map(t => <MiniTask key={t.id} task={t} />)}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// SpeakersBlock — 本場參與者清單；點 chip 開重指派彈窗
// ═════════════════════════════════════════════════════════════════
function SpeakersBlock({ speakers, lang, onEdit, magazine }: {
  speakers: MeetingSpeaker[];
  lang: "zh" | "en";
  onEdit: (sp: MeetingSpeaker) => void;
  magazine?: boolean;
}) {
  if (speakers.length === 0) return null;
  const L = lang === "zh"
    ? { title: "本場參與者", ext: "外部", team: "團隊", unknown: "未識別", edit: "重指派" }
    : { title: "PARTICIPANTS", ext: "External", team: "Team", unknown: "Unknown", edit: "Reassign" };
  return (
    <div style={magazine ? { marginBottom: 24 } : undefined}>
      <div style={{
        fontFamily: "var(--font-mono, monospace)", fontSize: magazine ? 10 : 10.5,
        color: cssVar.fg3, letterSpacing: magazine ? 2 : 1, textTransform: "uppercase",
        marginBottom: 10,
      }}>
        {L.title} · {speakers.length}
      </div>
      <div style={{
        display: "flex", flexDirection: magazine ? "row" : "column",
        flexWrap: magazine ? "wrap" : "nowrap",
        gap: 8,
      }}>
        {speakers.map(sp => <SpeakerChip key={sp.id} speaker={sp} onEdit={onEdit} lang={lang} />)}
      </div>
    </div>
  );
}

function SpeakerChip({ speaker, onEdit, lang }: {
  speaker: MeetingSpeaker;
  onEdit: (sp: MeetingSpeaker) => void;
  lang: "zh" | "en";
}) {
  const L = lang === "zh"
    ? { ext: "外部", team: "Team", unknown: "未識別" }
    : { ext: "External", team: "Team", unknown: "Unknown" };
  const tone: "warn" | "default" | "neutral" =
    speaker.match_source === "unknown" ? "neutral" : speaker.is_external ? "warn" : "default";
  const badgeText = speaker.match_source === "unknown"
    ? L.unknown
    : speaker.is_external ? L.ext : L.team;

  return (
    <button
      type="button"
      onClick={() => onEdit(speaker)}
      title={lang === "zh" ? "點擊重新指派" : "Click to reassign"}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 8,
        background: cssVar.ink2, border: `1px solid ${cssVar.line}`,
        color: cssVar.fg, cursor: "pointer", textAlign: "left",
      }}
    >
      <KAvatar name={speaker.display_name} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{speaker.display_name}</span>
          <KBadge tone={tone}>{badgeText}</KBadge>
        </div>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3, marginTop: 2 }}>
          {speaker.speaker_id}
          {speaker.external_org && ` · ${speaker.external_org}`}
          {speaker.match_source === "manual_override" && ` · ✓ manual`}
        </div>
      </div>
      <KIcon name="edit" size={12} color={cssVar.fg3} />
    </button>
  );
}

function TranscriptRow({ seg, magazine, anchored }: {
  seg: MeetingDetail["transcript"][0]; magazine?: boolean; anchored?: boolean;
}) {
  const isHl = !!seg.highlight;
  return (
    <div
      data-segment-ms={seg.start_ms}
      style={{
        display: "flex", gap: 12,
        padding: anchored ? 14 : isHl ? 10 : 0,
        background: anchored
          ? "color-mix(in srgb, var(--k-accent) 16%, transparent)"
          : isHl ? cssVar.accentSofter : "transparent",
        border: anchored ? `2px solid ${cssVar.accent}` : undefined,
        borderLeft: isHl && !anchored ? `2px solid ${cssVar.accent}` : undefined,
        borderRadius: anchored ? 8 : isHl ? 4 : 0,
        transition: "background .4s, padding .3s",
        scrollMarginTop: 72,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 2 }}>
        <KAvatar name={seg.speaker_name || seg.speaker_id} size={28} />
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 9, color: cssVar.fg4 }}>{seg.speaker_id}</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{seg.speaker_name}</span>
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3 }}>
            {formatMs(seg.start_ms)}
          </span>
          {seg.highlight && <KBadge tone="default">{seg.highlight}</KBadge>}
        </div>
        <div style={{ fontSize: magazine ? 14.5 : 13, lineHeight: 1.55, color: cssVar.fg2 }}>{seg.text}</div>
      </div>
    </div>
  );
}

function MiniTask({ task }: { task: MeetingDetail["tasks"][0] }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px", borderRadius: 8,
        background: cssVar.ink3, border: `1px solid ${cssVar.line}`,
        textDecoration: "none", color: cssVar.fg,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: 3, flex: "none",
        border: `1.5px solid ${task.status === "done" ? cssVar.ok : cssVar.line3}`,
        background: task.status === "done" ? cssVar.ok : "transparent",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        {task.status === "done" && <KIcon name="check" size={10} color={cssVar.accentInk} />}
      </div>
      <div style={{ flex: 1, fontSize: 13, textDecoration: task.status === "done" ? "line-through" : "none", color: task.status === "done" ? cssVar.fg3 : cssVar.fg }}>
        {task.title}
      </div>
      {task.tag && <KBadge tone="default">{task.tag}</KBadge>}
      {task.due_label && <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3 }}>{task.due_label}</span>}
      <KIcon name="chevronRight" size={12} color={cssVar.fg4} />
    </Link>
  );
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
