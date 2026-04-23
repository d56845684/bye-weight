"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { fetchAPI } from "@/lib/api";
import type { Task, MeetingListItem } from "@/lib/types";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBtn, KBadge, KAvatar } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { NewTaskDialog } from "@/components/NewTaskDialog";

// Action Board — 主頁。
// Variant A: Linear-style 3-column kanban + AI confidence rail
// Variant B: Today-focused timeline + grouped by owner

const STATUS_ORDER: { key: "todo" | "doing" | "done"; labelZh: string; labelEn: string }[] = [
  { key: "todo",  labelZh: "待辦",    labelEn: "Todo" },
  { key: "doing", labelZh: "進行中",  labelEn: "Doing" },
  { key: "done",  labelZh: "已完成",  labelEn: "Done" },
];

export default function BoardPage() {
  const { variant, lang } = usePrefs();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = () => Promise.all([
    fetchAPI<Task[]>("/tasks"),
    fetchAPI<MeetingListItem[]>("/meetings"),
  ]).then(([t, m]) => { setTasks(t); setMeetings(m); setLoading(false); });

  useEffect(() => { refresh(); }, []);

  return (
    <>
      <KTopbar
        title={lang === "zh" ? "行動事項" : "Action Board"}
        subtitle={`${tasks.length} items · ${meetings.filter(m => m.status === "processing").length} processing`}
        right={<>
          <KBtn icon="filter" small>{lang === "zh" ? "篩選" : "Filter"}</KBtn>
          <KBtn icon="plus" primary small style={{ marginLeft: 8 }} onClick={() => setShowNew(true)}>
            {lang === "zh" ? "新任務" : "New task"}
          </KBtn>
        </>}
      />
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {loading ? <div style={{ color: cssVar.fg3 }}>載入中…</div> : variant === "A"
          ? <BoardA tasks={tasks} meetings={meetings} lang={lang} />
          : <BoardB tasks={tasks} meetings={meetings} lang={lang} />}
      </div>
      {showNew && (
        <NewTaskDialog onClose={() => setShowNew(false)} onCreated={refresh} />
      )}
    </>
  );
}

// ════════════════════════════════════════════════
// Variant A — Linear-style 3-col kanban
// ════════════════════════════════════════════════
function BoardA({ tasks, meetings, lang }: { tasks: Task[]; meetings: MeetingListItem[]; lang: "zh" | "en" }) {
  const byStatus = groupBy(tasks, t => t.status);
  const processing = meetings.find(m => m.status === "processing");
  return (
    <div>
      {processing && <ProcessingBanner meeting={processing} lang={lang} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: processing ? 16 : 0 }}>
        {STATUS_ORDER.map(s => (
          <Column key={s.key} title={lang === "zh" ? s.labelZh : s.labelEn} items={byStatus[s.key] || []} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function Column({ title, items, lang }: { title: string; items: Task[]; lang: "zh" | "en" }) {
  return (
    <div style={{ background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingLeft: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3 }}>{items.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(t => <TaskCard key={t.id} task={t} lang={lang} />)}
        {items.length === 0 && <div style={{ color: cssVar.fg4, fontSize: 12, padding: 12, textAlign: "center" }}>—</div>}
      </div>
    </div>
  );
}

function TaskCard({ task, lang }: { task: Task; lang: "zh" | "en" }) {
  const prioTone = task.priority === "high" ? "danger" : task.priority === "med" ? "warn" : "neutral";
  const conf = task.ai_confidence ?? 0;
  return (
    <Link href={`/tasks/${task.id}`} style={{
      background: cssVar.ink3, border: `1px solid ${cssVar.line}`, borderRadius: 8, padding: 12,
      display: "flex", flexDirection: "column", gap: 8, cursor: "pointer",
      textDecoration: "none", color: "inherit",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {task.tag && <KBadge tone="default">{task.tag}</KBadge>}
        <KBadge tone={prioTone as any}>{task.priority}</KBadge>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3 }}>
          #{task.id}
        </span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.45, fontWeight: 500, color: cssVar.fg }}>{task.title}</div>
      {task.source_quote && (
        <div style={{ fontSize: 11, color: cssVar.fg3, fontStyle: "italic", lineHeight: 1.5, borderLeft: `2px solid ${cssVar.line2}`, paddingLeft: 8 }}>
          {task.source_quote}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        {task.owner_name && <KAvatar name={task.owner_name} size={20} />}
        <span style={{ fontSize: 11, color: cssVar.fg2 }}>{task.owner_name}</span>
        {task.due_label && (
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <KIcon name="clock" size={11} />{task.due_label}
          </span>
        )}
      </div>
      {/* AI confidence rail */}
      <div style={{ height: 2, borderRadius: 1, background: cssVar.line, overflow: "hidden", marginTop: 2 }}>
        <div style={{ width: `${Math.round(conf * 100)}%`, height: "100%", background: conf >= 0.9 ? cssVar.ok : conf >= 0.8 ? cssVar.accent : cssVar.warn }} />
      </div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 9, color: cssVar.fg4, letterSpacing: 0.5 }}>
        AI {Math.round(conf * 100)}% · {task.meeting_id
          ? (task.source_segment_start_ms != null
              ? `m${task.meeting_id} @ ${formatMs(task.source_segment_start_ms)}`
              : `m${task.meeting_id}`)
          : "manual"}
      </div>
    </Link>
  );
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ProcessingBanner({ meeting, lang }: { meeting: MeetingListItem; lang: "zh" | "en" }) {
  return (
    <div style={{
      background: cssVar.accentSofter, border: `1px solid ${cssVar.line2}`, borderRadius: 10,
      padding: 14, display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 16, background: cssVar.accentSoft, color: cssVar.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <KIcon name="sparkle" size={15} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {lang === "zh" ? `AI 正在處理「${meeting.title}」…` : `AI is processing "${meeting.title}"…`}
        </div>
        <div style={{ fontSize: 11, color: cssVar.fg3, fontFamily: "var(--font-mono, monospace)" }}>
          {lang === "zh" ? "幾分鐘後會自動補上 transcript 與行動事項" : "Transcript + tasks will appear in a few minutes"}
        </div>
      </div>
      <div style={{ width: 60, height: 3, borderRadius: 2, background: cssVar.line, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "-40%", width: "40%", height: "100%", background: cssVar.accent, animation: "k-blink 1.2s ease-in-out infinite" }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Variant B — Today-focused timeline + grouped by owner
// ════════════════════════════════════════════════
function BoardB({ tasks, lang }: { tasks: Task[]; meetings: MeetingListItem[]; lang: "zh" | "en" }) {
  const byOwner = groupBy(tasks.filter(t => t.status !== "done"), t => t.owner_name || "—");
  const done = tasks.filter(t => t.status === "done");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Hourly bar */}
      <div style={{ background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {lang === "zh" ? "今天（5/04）" : "Today · May 4"}
          </div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3 }}>
            9AM → 7PM · {tasks.filter(t => t.status !== "done").length} open
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, height: 28 }}>
          {Array.from({ length: 10 }).map((_, h) => (
            <div key={h} style={{ flex: 1, borderRadius: 4, background: h === 0 || h === 5 ? cssVar.accentSoft : cssVar.ink3, border: `1px solid ${cssVar.line}`, position: "relative" }}>
              <div style={{ position: "absolute", bottom: -14, left: 0, fontFamily: "var(--font-mono, monospace)", fontSize: 9, color: cssVar.fg4 }}>
                {9 + h}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grouped by owner */}
      {Object.entries(byOwner).map(([owner, items]) => (
        <div key={owner} style={{ background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <KAvatar name={owner} size={28} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>{owner}</div>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3, marginLeft: 6 }}>
              {items.length} {lang === "zh" ? "項" : "open"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map(t => <TimelineRow key={t.id} task={t} lang={lang} />)}
          </div>
        </div>
      ))}

      {/* Upcoming strip */}
      {done.length > 0 && (
        <div style={{ background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: cssVar.fg3, marginBottom: 8 }}>
            {lang === "zh" ? "最近完成" : "Recently done"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {done.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: cssVar.fg3 }}>
                <KIcon name="check" size={13} color={cssVar.ok} />
                <span style={{ flex: 1, textDecoration: "line-through" }}>{t.title}</span>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}>{t.due_label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineRow({ task, lang }: { task: Task; lang: "zh" | "en" }) {
  return (
    <Link href={`/tasks/${task.id}`} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", borderRadius: 6,
      background: cssVar.ink3, textDecoration: "none", color: "inherit",
    }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, background: task.priority === "high" ? cssVar.danger : task.priority === "med" ? cssVar.warn : cssVar.fg4 }} />
      <div style={{ flex: 1, fontSize: 13 }}>{task.title}</div>
      {task.tag && <KBadge tone="default">{task.tag}</KBadge>}
      {task.due_label && (
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3 }}>{task.due_label}</span>
      )}
    </Link>
  );
}

function groupBy<T, K extends string>(arr: T[], key: (v: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const v of arr) {
    const k = key(v);
    if (!out[k]) out[k] = [];
    out[k].push(v);
  }
  return out;
}
