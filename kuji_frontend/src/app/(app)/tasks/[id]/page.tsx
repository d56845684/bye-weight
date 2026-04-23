"use client";

import { useEffect, useState, Fragment } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { fetchAPI } from "@/lib/api";
import type { Task, TaskClip } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBtn, KBadge, KAvatar, KCard } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { AudioClipPlayer } from "@/components/AudioClipPlayer";

// Task detail —
// Variant A: 2-col (detail + activity)，含 AI suggestion + source clip
// Variant B: document thread，上下文對話 + AI 怎麼想
export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { variant, lang } = usePrefs();
  const router = useRouter();
  const [t, setT] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchAPI<Task>(`/tasks/${id}`).then(setT); }, [id]);

  const markDone = async () => {
    if (!t) return;
    setBusy(true);
    await fetchAPI(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    const updated = await fetchAPI<Task>(`/tasks/${t.id}`);
    setT(updated);
    setBusy(false);
  };

  const del = async () => {
    if (!t) return;
    if (!confirm(lang === "zh" ? "確定刪除此任務？" : "Delete this task?")) return;
    await fetchAPI(`/tasks/${t.id}`, { method: "DELETE" });
    router.push("/board");
  };

  if (!t) return <div style={{ padding: 40, color: cssVar.fg3 }}>載入中…</div>;

  return (
    <>
      <KTopbar
        backHref="/board"
        title={lang === "zh" ? "任務詳情" : "Task"}
        subtitle={`#${t.id}${t.meeting_id ? ` · meeting #${t.meeting_id}` : ""}`}
        right={<>
          <KBtn small icon="check" onClick={markDone} disabled={t.status === "done" || busy}>
            {t.status === "done" ? (lang === "zh" ? "已完成" : "Done") : (lang === "zh" ? "完成" : "Mark done")}
          </KBtn>
          <KBtn small danger icon="trash" onClick={del} style={{ marginLeft: 8 }}>
            {lang === "zh" ? "刪除" : "Delete"}
          </KBtn>
        </>}
      />
      <div style={{ flex: 1, overflow: "auto" }}>
        {variant === "A" ? <TaskA task={t} lang={lang} /> : <TaskB task={t} lang={lang} />}
      </div>
    </>
  );
}

function TaskA({ task, lang }: { task: Task; lang: "zh" | "en" }) {
  const L = lang === "zh" ? {
    suggest: "AI 建議", source: "來源片段", activity: "活動",
    owner: "負責人", due: "期限", dest: "同步到", meeting: "來源會議",
    reassignWhy: `信心度 ${Math.round((task.ai_confidence ?? 0) * 100)}%，若不正確可改派或改期。`,
  } : {
    suggest: "AI suggestion", source: "Source clip", activity: "Activity",
    owner: "Owner", due: "Due", dest: "Sync to", meeting: "Source meeting",
    reassignWhy: `Confidence ${Math.round((task.ai_confidence ?? 0) * 100)}%. Reassign or reschedule if needed.`,
  };
  const acts = [
    { who: "AI", when: "10:41", what: lang === "zh" ? `從 meeting #${task.meeting_id} 抽出此任務` : `Extracted from meeting #${task.meeting_id}`, icon: "sparkle" as const, tone: cssVar.accent },
    { who: task.owner_name ?? "—", when: "10:44", what: lang === "zh" ? "接受了任務" : "Accepted the task", icon: "check" as const, tone: cssVar.ok },
    { who: "AI", when: "11:02", what: lang === "zh" ? `已同步到 ${task.tag}` : `Synced to ${task.tag}`, icon: "link" as const, tone: cssVar.fg2 },
    { who: "Emily", when: "11:05", what: lang === "zh" ? `把期限改成 ${task.due_label}` : `Changed due to ${task.due_label}`, icon: "edit" as const, tone: cssVar.fg2 },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", minHeight: "100%" }}>
      {/* left: detail */}
      <div style={{ padding: "28px 32px", borderRight: `1px solid ${cssVar.line}`, overflow: "auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <KBadge tone={task.priority === "high" ? "warn" : task.priority === "med" ? "neutral" : "neutral"}>
            {task.priority.toUpperCase()}
          </KBadge>
          <KBadge tone="neutral">{task.status.toUpperCase()}</KBadge>
          {task.tag && <KBadge>→ {task.tag.toUpperCase()}</KBadge>}
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.25, margin: "0 0 24px" }}>
          {task.title}
        </h1>

        {/* AI suggestion */}
        <div style={{ padding: 16, background: cssVar.accentSoft, border: `1px solid ${cssVar.accent}`, borderRadius: 10, marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.accent, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>
            <KIcon name="sparkle" size={12} />{L.suggest}
          </div>
          <div style={{ fontSize: 13.5, color: cssVar.fg, lineHeight: 1.6 }}>{L.reassignWhy}</div>
        </div>

        {/* clips：primary + related */}
        {task.clips.length > 0 && <ClipsBlock clips={task.clips} lang={lang} />}

        {/* fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            { l: L.owner, v: task.owner_name
              ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <KAvatar name={task.owner_name} size={20} /><span style={{ fontSize: 13 }}>{task.owner_name}</span>
                </div>
              : <span style={{ fontSize: 13, color: cssVar.fg3 }}>—</span> },
            { l: L.due, v: <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, color: cssVar.warn }}>{task.due_label || "—"}</span> },
            { l: L.meeting, v: task.meeting_id
              ? <Link
                  href={`/meetings/${task.meeting_id}${task.source_segment_start_ms != null ? `#t${task.source_segment_start_ms}` : ""}`}
                  style={{ fontSize: 13, color: cssVar.accent, textDecoration: "none" }}
                >
                  meeting #{task.meeting_id}
                  {task.source_segment_start_ms != null && ` · ${formatMs(task.source_segment_start_ms)}`}
                </Link>
              : <span style={{ fontSize: 13, color: cssVar.fg3 }}>—</span> },
            { l: L.dest, v: <span style={{ fontSize: 13 }}>{task.tag || "—"}</span> },
          ].map((row, i) => (
            <div key={i} style={{ padding: 12, background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 8 }}>
              <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg4, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>{row.l}</div>
              {row.v}
            </div>
          ))}
        </div>
      </div>

      {/* right: activity */}
      <div style={{ padding: "28px 24px", overflow: "auto" }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>
          {L.activity}
        </div>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 11, top: 10, bottom: 20, width: 1, background: cssVar.line }} />
          {acts.map((a, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 11,
                background: cssVar.ink2, border: `1px solid ${cssVar.line2}`,
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1,
              }}>
                <KIcon name={a.icon} size={11} color={a.tone} />
              </div>
              <div>
                <div style={{ fontSize: 12.5 }}>
                  <b style={{ fontWeight: 500 }}>{a.who}</b>{" "}
                  <span style={{ color: cssVar.fg2 }}>{a.what}</span>
                </div>
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4, marginTop: 2 }}>
                  {a.when}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 16, padding: 12,
          background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 8,
          fontSize: 12.5, color: cssVar.fg3,
        }}>
          {lang === "zh" ? "寫個評論或 @ 某人…" : "Write a comment or @mention…"}
        </div>
      </div>
    </div>
  );
}

function TaskB({ task, lang }: { task: Task; lang: "zh" | "en" }) {
  return (
    <div style={{ padding: "32px 48px 60px", maxWidth: 780, margin: "0 auto", width: "100%" }}>
      {/* breadcrumb */}
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3, marginBottom: 20, display: "flex", alignItems: "center", gap: 6 }}>
        <span>meeting #{task.meeting_id ?? "—"}</span>
        <KIcon name="chevronRight" size={11} />
        <span style={{ color: cssVar.accent }}>task #{task.id}</span>
      </div>

      {/* title */}
      <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.8, lineHeight: 1.2, margin: "0 0 10px" }}>
        {task.title}
      </h1>
      <div style={{ display: "flex", gap: 14, marginBottom: 28, fontSize: 13, color: cssVar.fg2, alignItems: "center", flexWrap: "wrap" }}>
        {task.owner_name && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <KAvatar name={task.owner_name} size={22} />{task.owner_name}
          </div>
        )}
        {task.due_label && <>
          <span style={{ color: cssVar.fg4 }}>·</span>
          <span style={{ fontFamily: "var(--font-mono, monospace)", color: cssVar.warn, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <KIcon name="clock" size={12} />{task.due_label}
          </span>
        </>}
        {task.tag && <>
          <span style={{ color: cssVar.fg4 }}>·</span>
          <KBadge>→ {task.tag.toUpperCase()}</KBadge>
        </>}
      </div>

      {/* clips：primary + related */}
      {task.clips.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <ClipsBlock clips={task.clips} lang={lang} />
        </div>
      )}

      {/* AI reasoning */}
      <div style={{ padding: 18, border: `1px dashed ${cssVar.line2}`, borderRadius: 10, marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.accent, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
          <KIcon name="sparkle" size={11} /> {lang === "zh" ? "AI 怎麼想的" : "How AI parsed this"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: 12.5, lineHeight: 1.6 }}>
          {([
            ["WHO",   task.owner_name || "—"],
            ["WHAT",  task.title],
            ["WHEN",  task.due_label || "—"],
            ["WHY",   task.tag ? `路由到 ${task.tag}` : "—"],
            ["CONFIDENCE", task.ai_confidence ? `${Math.round(task.ai_confidence * 100)}%` : "—"],
          ] as const).map(([k, v]) => (
            <Fragment key={k}>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4 }}>{k}</span>
              <span style={{ color: cssVar.fg }}>{v}</span>
            </Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <KBtn primary icon="check">{lang === "zh" ? "完成" : "Done"}</KBtn>
        <KBtn icon="user">{lang === "zh" ? "改派" : "Reassign"}</KBtn>
        <KBtn icon="calendar">{lang === "zh" ? "改期" : "Reschedule"}</KBtn>
        <KBtn ghost icon="trash" danger>{lang === "zh" ? "刪除" : "Delete"}</KBtn>
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ═════════════════════════════════════════════════════════════════
// ClipsBlock — primary 大、related 小。每個 clip 都有 AudioClipPlayer。
// ═════════════════════════════════════════════════════════════════
function ClipsBlock({ clips, lang }: { clips: TaskClip[]; lang: "zh" | "en" }) {
  const primary = clips.find(c => c.role === "primary");
  const related = clips.filter(c => c.role === "related").sort((a, b) => a.rank - b.rank);

  const L = lang === "zh"
    ? { primary: "主要片段", related: "相關片段", conf: "信心度" }
    : { primary: "PRIMARY CLIP", related: "RELATED CLIPS", conf: "Confidence" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {primary && <ClipCard clip={primary} lang={lang} label={L.primary} primary />}
      {related.length > 0 && (
        <div>
          <div style={{
            fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3,
            letterSpacing: 1, textTransform: "uppercase", marginBottom: 8,
          }}>
            {L.related} · {related.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {related.map(c => <ClipCard key={c.id} clip={c} lang={lang} label="" compact />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ClipCard({ clip, lang, label, primary, compact }: {
  clip: TaskClip;
  lang: "zh" | "en";
  label: string;
  primary?: boolean;
  compact?: boolean;
}) {
  const conf = clip.ai_confidence ?? 0;
  return (
    <div style={{
      padding: compact ? 12 : 18,
      background: cssVar.ink2,
      border: `1px solid ${primary ? "color-mix(in srgb, var(--k-accent) 35%, transparent)" : cssVar.line}`,
      borderRadius: 10,
    }}>
      {label && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
          fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.accent,
          letterSpacing: 1, textTransform: "uppercase",
        }}>
          <KIcon name="sparkle" size={11} /> {label}
          {clip.ai_confidence != null && (
            <span style={{ marginLeft: "auto", color: cssVar.fg3, fontFamily: "var(--font-mono, monospace)" }}>
              AI {Math.round(conf * 100)}%
            </span>
          )}
        </div>
      )}
      <div style={{ marginBottom: compact ? 6 : 10 }}>
        <AudioClipPlayer
          audioUrl={clip.audio_url}
          startMs={clip.start_ms}
          endMs={clip.end_ms}
          compact={compact}
        />
      </div>
      <div style={{
        fontSize: compact ? 12.5 : 13.5,
        fontStyle: "italic",
        color: cssVar.fg2,
        lineHeight: 1.55,
        paddingLeft: 10,
        borderLeft: `2px solid ${primary ? cssVar.accent : cssVar.line2}`,
      }}>
        {clip.speaker_name && <span style={{ fontStyle: "normal", fontWeight: 500, color: cssVar.fg, marginRight: 6 }}>{clip.speaker_name}:</span>}
        {clip.text}
      </div>
      {!compact && clip.note && (
        <div style={{
          marginTop: 8, fontSize: 11, color: cssVar.fg3,
          fontFamily: "var(--font-mono, monospace)",
        }}>
          ↳ {clip.note}
        </div>
      )}
      {clip.meeting_id && (
        <Link
          href={`/meetings/${clip.meeting_id}#t${clip.start_ms}`}
          style={{
            marginTop: compact ? 6 : 10, display: "inline-flex", alignItems: "center", gap: 4,
            fontFamily: "var(--font-mono, monospace)", fontSize: 10.5,
            color: cssVar.accent, textDecoration: "none",
          }}
        >
          {lang === "zh" ? "跳到逐字稿" : "Jump to transcript"} →
        </Link>
      )}
    </div>
  );
}
