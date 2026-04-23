"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBtn, KBadge, KWave } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { fetchAPI, ApiError } from "@/lib/api";
import { useRouter } from "next/navigation";

// Record — live recording UI。MVP 這裡只 mock 錄音按鈕，實際不接 ASR；
// 點「開始錄音」會建一筆 meeting 進 backend，stop 後導到 detail。
export default function RecordPage() {
  const { variant, lang } = usePrefs();
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [title, setTitle] = useState(lang === "zh" ? "未命名會議" : "Untitled meeting");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const m = await fetchAPI<{ id: number }>("/meetings", {
        method: "POST",
        body: JSON.stringify({ title, source: "record" }),
      });
      setRecording(true);
      // 使用者按 stop 時才導頁；這裡先把 id stash
      (window as any).__kujiMeetingId = m.id;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "建立會議失敗");
    } finally { setBusy(false); }
  };

  const stop = async () => {
    const id = (window as any).__kujiMeetingId;
    if (!id) return;
    try {
      await fetchAPI(`/meetings/${id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    } catch {}
    router.push(`/meetings/${id}`);
  };

  return (
    <>
      <KTopbar
        title={lang === "zh" ? "即時錄音" : "Live record"}
        subtitle={recording ? (lang === "zh" ? "錄音中…" : "Recording…") : (lang === "zh" ? "按下錄音開始" : "Press to start")}
        right={recording ? <KBadge tone="danger">● REC</KBadge> : <KBadge tone="neutral">IDLE</KBadge>}
      />
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {variant === "A" ? (
          <RecordA recording={recording} title={title} setTitle={setTitle} start={start} stop={stop} busy={busy} err={err} lang={lang} />
        ) : (
          <RecordB recording={recording} title={title} setTitle={setTitle} start={start} stop={stop} busy={busy} err={err} lang={lang} />
        )}
      </div>
    </>
  );
}

type RecProps = {
  recording: boolean; title: string; setTitle: (v: string) => void;
  start: () => void; stop: () => void; busy: boolean; err: string | null;
  lang: "zh" | "en";
};

function RecordA(p: RecProps) {
  return (
    <div style={{ background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 12, padding: 40, minHeight: 400 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <input
          value={p.title}
          onChange={(e) => p.setTitle(e.target.value)}
          disabled={p.recording}
          style={{
            width: "100%", maxWidth: 520, fontSize: 20, fontWeight: 600,
            textAlign: "center", background: "transparent", border: "none",
            borderBottom: `1px solid ${cssVar.line2}`, padding: "10px 0", color: cssVar.fg,
            letterSpacing: -0.4, outline: "none",
          }}
        />
        <div style={{ width: "100%", maxWidth: 640, padding: "30px 20px", background: cssVar.ink3, borderRadius: 10 }}>
          <KWave bars={48} height={60} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {!p.recording ? (
            <KBtn primary icon="mic" onClick={p.start} style={{ padding: "14px 24px", fontSize: 15 }}>
              {p.busy ? "…" : (p.lang === "zh" ? "開始錄音" : "Start")}
            </KBtn>
          ) : (
            <KBtn danger icon="stop" onClick={p.stop} style={{ padding: "14px 24px", fontSize: 15 }}>
              {p.lang === "zh" ? "停止" : "Stop"}
            </KBtn>
          )}
        </div>
        {p.err && <div style={{ color: cssVar.danger, fontSize: 12 }}>{p.err}</div>}
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4, letterSpacing: 1, textTransform: "uppercase" }}>
          MVP · ASR pipeline stub
        </div>
      </div>
    </div>
  );
}

function RecordB(p: RecProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, paddingTop: 40 }}>
      <div style={{ textAlign: "center" }}>
        <input
          value={p.title}
          onChange={(e) => p.setTitle(e.target.value)}
          disabled={p.recording}
          style={{
            fontSize: 28, fontWeight: 600, textAlign: "center",
            background: "transparent", border: "none", color: cssVar.fg,
            letterSpacing: -0.6, outline: "none", width: 520,
          }}
        />
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg4, marginTop: 6, letterSpacing: 2 }}>
          {p.recording ? "RECORDING" : "READY"}
        </div>
      </div>
      <button
        onClick={p.recording ? p.stop : p.start}
        disabled={p.busy}
        style={{
          width: 120, height: 120, borderRadius: 60,
          background: p.recording ? cssVar.danger : cssVar.accent,
          color: cssVar.accentInk, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: p.recording ? "0 0 40px rgba(239,68,68,.5)" : "0 0 40px color-mix(in srgb, var(--k-accent) 40%, transparent)",
        }}
      >
        <KIcon name={p.recording ? "stop" : "mic"} size={48} />
      </button>
      <div style={{ width: "100%", maxWidth: 520 }}><KWave bars={60} height={40} /></div>
      {p.err && <div style={{ color: cssVar.danger, fontSize: 12 }}>{p.err}</div>}
    </div>
  );
}
