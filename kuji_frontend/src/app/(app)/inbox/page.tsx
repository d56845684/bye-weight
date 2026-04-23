"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchAPI } from "@/lib/api";
import type { Task, MeetingListItem, Me } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBadge, KBtn, KAvatar } from "@/lib/ds/primitives";
import { KIcon, IconName } from "@/lib/ds/KIcon";

// Inbox — AI 通知聚合。從現有 /tasks /meetings /me 衍生，不需要新 backend endpoint。
// 四類來源：
//   recording — 正在錄音（badge RED）
//   processing — AI 轉寫中（badge WARN）
//   new-task — AI 剛抽出、指派給我、狀態=todo（badge ACCENT）
//   routed — 任務已同步到整合（badge OK，灰色低優先）

type InboxItem = {
  key: string;
  kind: "recording" | "processing" | "new-task" | "routed";
  icon: IconName;
  tone: "danger" | "warn" | "default" | "ok" | "neutral";
  title: string;
  excerpt?: string;
  timestamp: string;
  href: string;
  unread: boolean;
  actor?: string;
};

export default function InboxPage() {
  const { variant, lang } = usePrefs();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "mentions">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [t, m, meData] = await Promise.all([
          fetchAPI<Task[]>("/tasks"),
          fetchAPI<MeetingListItem[]>("/meetings"),
          fetchAPI<Me>("/me"),
        ]);
        setTasks(t); setMeetings(m); setMe(meData);
      } finally { setLoading(false); }
    })();
  }, []);

  const items = useMemo(() => buildInbox(tasks, meetings, me, lang), [tasks, meetings, me, lang]);
  const filtered = filter === "unread" ? items.filter(i => i.unread)
                 : filter === "mentions" ? items.filter(i => i.kind === "new-task")
                 : items;

  const unreadCount = items.filter(i => i.unread).length;
  const L = lang === "zh" ? {
    title: "通知提醒", subtitle: `${unreadCount} 未讀 · ${items.length} 筆通知`,
    tabAll: "全部", tabUnread: "未讀", tabMentions: "我的提及",
    markAll: "全部標為已讀",
    empty: "目前沒有新通知",
  } : {
    title: "Notifications", subtitle: `${unreadCount} unread · ${items.length} total`,
    tabAll: "All", tabUnread: "Unread", tabMentions: "Mentions",
    markAll: "Mark all read",
    empty: "Nothing new",
  };

  return (
    <>
      <KTopbar
        title={L.title}
        subtitle={L.subtitle}
        right={
          unreadCount > 0
            ? <KBtn small icon="check">{L.markAll}</KBtn>
            : undefined
        }
      />
      {/* tabs */}
      <div style={{ display: "flex", gap: 4, padding: "0 20px", borderBottom: `1px solid ${cssVar.line}` }}>
        {([
          { k: "all" as const,      label: L.tabAll,      count: items.length },
          { k: "unread" as const,   label: L.tabUnread,   count: unreadCount },
          { k: "mentions" as const, label: L.tabMentions, count: items.filter(i => i.kind === "new-task").length },
        ]).map(tab => (
          <button
            key={tab.k}
            onClick={() => setFilter(tab.k)}
            style={{
              padding: "12px 14px", fontSize: 13,
              color: filter === tab.k ? cssVar.fg : cssVar.fg3,
              borderBottom: filter === tab.k ? `1.5px solid ${cssVar.accent}` : "1.5px solid transparent",
              background: "transparent", border: "none", borderTop: "none", borderLeft: "none", borderRight: "none",
              cursor: "pointer",
            }}
          >
            {tab.label}
            <span style={{
              marginLeft: 6, fontFamily: "var(--font-mono, monospace)", fontSize: 11,
              color: cssVar.fg4,
            }}>{tab.count}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {loading ? <div style={{ color: cssVar.fg3 }}>載入中…</div> :
          filtered.length === 0 ? <EmptyState label={L.empty} /> :
          variant === "A"
            ? <ListA items={filtered} />
            : <ListB items={filtered} lang={lang} />
        }
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════
// Variant A — dense list
// ═════════════════════════════════════════════════════════════════
function ListA({ items }: { items: InboxItem[] }) {
  return (
    <div style={{
      background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10, overflow: "hidden",
    }}>
      {items.map((it, i) => (
        <Link key={it.key} href={it.href} style={{
          display: "grid", gridTemplateColumns: "32px 1fr 100px",
          gap: 12, padding: "14px 18px",
          borderTop: i === 0 ? "none" : `1px solid ${cssVar.line}`,
          background: it.unread ? "color-mix(in srgb, var(--k-accent) 4%, transparent)" : "transparent",
          textDecoration: "none", color: cssVar.fg,
          alignItems: "center",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: toneBg(it.tone), color: toneFg(it.tone),
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <KIcon name={it.icon} size={15} color={toneFg(it.tone)} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              {it.unread && <span style={{ width: 6, height: 6, borderRadius: 3, background: cssVar.accent, flex: "none" }} />}
              <span style={{ fontSize: 13.5, fontWeight: it.unread ? 500 : 400 }}>{it.title}</span>
            </div>
            {it.excerpt && (
              <div style={{ fontSize: 12, color: cssVar.fg3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.excerpt}
              </div>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4, textAlign: "right" }}>
            {it.timestamp}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Variant B — card / magazine style
// ═════════════════════════════════════════════════════════════════
function ListB({ items, lang }: { items: InboxItem[]; lang: "zh" | "en" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map(it => (
        <Link key={it.key} href={it.href} style={{
          display: "grid", gridTemplateColumns: "40px 1fr auto", gap: 14,
          padding: 16, background: cssVar.ink2,
          border: `1px solid ${it.unread ? "color-mix(in srgb, var(--k-accent) 25%, transparent)" : cssVar.line}`,
          borderRadius: 10, textDecoration: "none", color: cssVar.fg,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: toneBg(it.tone), color: toneFg(it.tone),
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <KIcon name={it.icon} size={18} color={toneFg(it.tone)} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              {it.unread && <KBadge tone={it.tone as any}>{labelFor(it.kind, lang)}</KBadge>}
              <span style={{ fontSize: 14, fontWeight: 600 }}>{it.title}</span>
            </div>
            {it.excerpt && (
              <div style={{ fontSize: 12.5, color: cssVar.fg2, lineHeight: 1.55 }}>{it.excerpt}</div>
            )}
            {it.actor && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <KAvatar name={it.actor} size={16} />
                <span style={{ fontSize: 11, color: cssVar.fg3 }}>{it.actor}</span>
              </div>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4, whiteSpace: "nowrap" }}>
            {it.timestamp}
          </div>
        </Link>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{
      padding: 60, textAlign: "center", color: cssVar.fg4,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
    }}>
      <KIcon name="bell" size={32} color={cssVar.fg4} />
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════
function toneBg(t: InboxItem["tone"]): string {
  switch (t) {
    case "danger":  return "color-mix(in srgb, var(--k-danger) 13%, transparent)";
    case "warn":    return "color-mix(in srgb, var(--k-warn)   13%, transparent)";
    case "ok":      return "color-mix(in srgb, var(--k-ok)     13%, transparent)";
    case "default": return cssVar.accentSoft;
    case "neutral": return cssVar.ink3;
  }
}
function toneFg(t: InboxItem["tone"]): string {
  switch (t) {
    case "danger":  return cssVar.danger;
    case "warn":    return cssVar.warn;
    case "ok":      return cssVar.ok;
    case "default": return cssVar.accent;
    case "neutral": return cssVar.fg3;
  }
}
function labelFor(kind: InboxItem["kind"], lang: "zh" | "en"): string {
  if (lang === "zh") return { recording: "錄音中", processing: "處理中", "new-task": "新任務", routed: "已同步" }[kind];
  return { recording: "LIVE", processing: "PROCESSING", "new-task": "NEW", routed: "ROUTED" }[kind];
}

function buildInbox(tasks: Task[], meetings: MeetingListItem[], me: Me | null, lang: "zh" | "en"): InboxItem[] {
  const items: InboxItem[] = [];

  // 1. 正在錄音 / 正在處理的會議
  for (const m of meetings) {
    if (m.status === "recording") {
      items.push({
        key: `m-rec-${m.id}`,
        kind: "recording",
        icon: "mic",
        tone: "danger",
        title: lang === "zh" ? `正在錄音：${m.title}` : `Recording: ${m.title}`,
        excerpt: lang === "zh" ? "會議結束後 AI 會自動抽取行動事項" : "AI will extract action items after the meeting ends",
        timestamp: lang === "zh" ? "現在" : "Now",
        href: `/meetings/${m.id}`,
        unread: true,
      });
    } else if (m.status === "processing") {
      items.push({
        key: `m-proc-${m.id}`,
        kind: "processing",
        icon: "sparkle",
        tone: "warn",
        title: lang === "zh" ? `AI 正在處理：${m.title}` : `Processing: ${m.title}`,
        excerpt: lang === "zh" ? `${m.speaker_count} 位說話者 · 幾分鐘後完成` : `${m.speaker_count} speakers · ready in a few minutes`,
        timestamp: formatTs(m.scheduled_at, lang),
        href: `/meetings/${m.id}`,
        unread: true,
      });
    }
  }

  // 2. AI 剛抽出、指派給我、狀態=todo 的任務
  const myUid = me?.user_id;
  for (const t of tasks) {
    if (t.status === "todo" && myUid && t.owner_user_id === myUid) {
      items.push({
        key: `t-new-${t.id}`,
        kind: "new-task",
        icon: "sparkle",
        tone: "default",
        title: lang === "zh" ? `新任務指派給你：${t.title}` : `New task for you: ${t.title}`,
        excerpt: t.source_quote ?? undefined,
        actor: t.owner_name ?? undefined,
        timestamp: t.due_label ?? (lang === "zh" ? "今天" : "Today"),
        href: `/tasks/${t.id}`,
        unread: true,
      });
    }
  }

  // 3. 已路由（status=done 且有 tag）— 顯示低優先、已讀
  for (const t of tasks) {
    if (t.status === "done" && t.tag) {
      items.push({
        key: `t-route-${t.id}`,
        kind: "routed",
        icon: "link",
        tone: "ok",
        title: lang === "zh" ? `已同步到 ${t.tag}：${t.title}` : `Synced to ${t.tag}: ${t.title}`,
        timestamp: t.due_label ?? "",
        href: `/tasks/${t.id}`,
        unread: false,
      });
    }
  }

  return items;
}

function formatTs(iso: string | null, lang: "zh" | "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(lang === "zh" ? "zh-TW" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
