"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchAPI } from "@/lib/api";
import type { MeetingListItem } from "@/lib/types";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBadge, KBtn } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";

export default function MeetingsListPage() {
  const { variant, lang } = usePrefs();
  const router = useRouter();
  const [items, setItems] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetchAPI<MeetingListItem[]>("/meetings").then(x => { setItems(x); setLoading(false); });
  }, []);

  return (
    <>
      <KTopbar
        title={lang === "zh" ? "會議" : "Meetings"}
        subtitle={`${items.length} total`}
        right={<KBtn primary small icon="plus" onClick={() => setShowNew(true)}>{lang === "zh" ? "新會議" : "New meeting"}</KBtn>}
      />
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {loading ? <div style={{ color: cssVar.fg3 }}>載入中…</div> :
          variant === "A"
            ? <Table items={items} lang={lang} />
            : <Cards items={items} lang={lang} />
        }
      </div>
      {showNew && (
        <NewMeetingDialog
          onClose={() => setShowNew(false)}
          onPick={(mode) => {
            setShowNew(false);
            router.push(mode === "record" ? "/record" : "/upload");
          }}
        />
      )}
    </>
  );
}

// New meeting 彈窗 — 選「即時錄音」或「上傳音檔」。
// 真正建 meeting 發生在 record / upload 頁內 (POST /meetings)。
function NewMeetingDialog({ onClose, onPick }: {
  onClose: () => void;
  onPick: (mode: "record" | "upload") => void;
}) {
  const { lang } = usePrefs();
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
          width: "100%", maxWidth: 460, background: cssVar.ink2,
          border: `1px solid ${cssVar.line2}`, borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)", color: cssVar.fg,
          padding: 22,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          {lang === "zh" ? "新會議" : "New meeting"}
        </div>
        <div style={{ fontSize: 12.5, color: cssVar.fg3, marginBottom: 18 }}>
          {lang === "zh" ? "選擇一種方式建立：" : "Choose how to start:"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Choice
            icon="mic"
            title={lang === "zh" ? "即時錄音" : "Record live"}
            desc={lang === "zh" ? "現場會議 · 即時轉寫" : "Live · real-time"}
            primary
            onClick={() => onPick("record")}
          />
          <Choice
            icon="upload"
            title={lang === "zh" ? "上傳音檔" : "Upload audio"}
            desc={lang === "zh" ? "過往會議 · 批次處理" : "Past meeting · batch"}
            onClick={() => onPick("upload")}
          />
        </div>
      </div>
    </div>
  );
}

function Choice({ icon, title, desc, primary, onClick }: {
  icon: "mic" | "upload"; title: string; desc: string; primary?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: 18, textAlign: "left", cursor: "pointer",
      background: cssVar.ink3,
      border: `${primary ? "1.5px" : "1px"} solid ${primary ? cssVar.accent : cssVar.line2}`,
      borderRadius: 10, color: cssVar.fg,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: primary ? cssVar.accentSoft : cssVar.ink2,
        color: primary ? cssVar.accent : cssVar.fg2,
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10,
      }}>
        <KIcon name={icon} size={18} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: cssVar.fg3 }}>{desc}</div>
    </button>
  );
}

function Table({ items, lang }: { items: MeetingListItem[]; lang: "zh" | "en" }) {
  return (
    <div style={{ background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 0.5fr",
        padding: "10px 16px", borderBottom: `1px solid ${cssVar.line}`,
        fontFamily: "var(--font-mono, monospace)", fontSize: 10, letterSpacing: 1,
        color: cssVar.fg3, textTransform: "uppercase",
      }}>
        <div>{lang === "zh" ? "標題" : "Title"}</div>
        <div>{lang === "zh" ? "日期" : "Date"}</div>
        <div>{lang === "zh" ? "時長" : "Duration"}</div>
        <div>{lang === "zh" ? "發言者" : "Speakers"}</div>
        <div>{lang === "zh" ? "任務" : "Tasks"}</div>
        <div>{lang === "zh" ? "狀態" : "Status"}</div>
      </div>
      {items.map(m => (
        <Link key={m.id} href={`/meetings/${m.id}`} style={{
          display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 0.5fr",
          padding: "12px 16px", borderBottom: `1px solid ${cssVar.line}`,
          fontSize: 13, textDecoration: "none", color: cssVar.fg,
          alignItems: "center",
        }}>
          <div style={{ fontWeight: 500 }}>{m.title}</div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: cssVar.fg2 }}>{m.scheduled_at?.slice(0, 10)}</div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: cssVar.fg2 }}>{formatDur(m.duration_sec)}</div>
          <div style={{ fontSize: 12, color: cssVar.fg2 }}>{m.speaker_count}</div>
          <div style={{ fontSize: 12, color: cssVar.fg2 }}>{m.task_count}</div>
          <div>
            <KBadge tone={m.status === "done" ? "ok" : m.status === "processing" ? "warn" : "danger"}>
              {m.status}
            </KBadge>
          </div>
        </Link>
      ))}
    </div>
  );
}

function Cards({ items, lang }: { items: MeetingListItem[]; lang: "zh" | "en" }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {items.map(m => (
        <Link key={m.id} href={`/meetings/${m.id}`} style={{
          background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10,
          padding: 16, textDecoration: "none", color: cssVar.fg,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <KIcon name="meeting" size={14} color={cssVar.accent} />
            <KBadge tone={m.status === "done" ? "ok" : m.status === "processing" ? "warn" : "danger"}>{m.status}</KBadge>
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3 }}>
              {m.scheduled_at?.slice(0, 10)}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{m.title}</div>
          <div style={{ display: "flex", gap: 14, fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3 }}>
            <span>{formatDur(m.duration_sec)}</span>
            <span>· {m.speaker_count} {lang === "zh" ? "人" : "spkrs"}</span>
            <span>· {m.task_count} {lang === "zh" ? "任務" : "tasks"}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function formatDur(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
