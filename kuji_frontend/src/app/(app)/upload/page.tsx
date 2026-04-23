"use client";

import { useState, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KTopbar } from "@/lib/ds/chrome";
import { KBtn, KBadge, KCard } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { fetchAPI } from "@/lib/api";

type QueueItem = { name: string; size: number; status: "pending" | "processing" | "done" };

export default function UploadPage() {
  const { variant, lang } = usePrefs();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const router = useRouter();

  const addFiles = (files: FileList) => {
    const items = Array.from(files).map(f => ({ name: f.name, size: f.size, status: "pending" as const }));
    setQueue(q => [...q, ...items]);
    // Mock：把每個 file 建成 meeting（status processing）
    items.forEach(async (it) => {
      try {
        const m = await fetchAPI<{ id: number }>("/meetings", {
          method: "POST",
          body: JSON.stringify({ title: it.name.replace(/\.[^.]+$/, ""), source: "upload" }),
        });
        setQueue(q => q.map(x => x.name === it.name ? { ...x, status: "processing" } : x));
        setTimeout(() => setQueue(q => q.map(x => x.name === it.name ? { ...x, status: "done" } : x)), 1200);
        void m;
      } catch {
        setQueue(q => q.map(x => x.name === it.name ? { ...x, status: "done" } : x));
      }
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <>
      <KTopbar
        title={lang === "zh" ? "上傳音檔" : "Upload"}
        subtitle={`${queue.length} files · ${queue.filter(q => q.status === "done").length} done`}
        right={<KBtn primary small icon="arrowRight" onClick={() => router.push("/meetings")}>
          {lang === "zh" ? "前往會議列表" : "Go to meetings"}
        </KBtn>}
      />
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragOver ? cssVar.accent : cssVar.line2}`,
            borderRadius: 12, padding: variant === "B" ? 80 : 48,
            background: dragOver ? cssVar.accentSofter : cssVar.ink2,
            textAlign: "center", transition: "all .15s",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <KIcon name="upload" size={variant === "B" ? 64 : 36} color={cssVar.accent} stroke={1.2} />
            <div style={{ fontSize: variant === "B" ? 20 : 16, fontWeight: 600 }}>
              {lang === "zh" ? "拖拉音檔到這裡" : "Drop audio here"}
            </div>
            <div style={{ fontSize: 12, color: cssVar.fg3 }}>
              {lang === "zh" ? "支援 mp3 / m4a / wav / mp4；或" : "Supports mp3 / m4a / wav / mp4 · or"}
              <label style={{ color: cssVar.accent, cursor: "pointer", marginLeft: 6 }}>
                {lang === "zh" ? "點此選檔" : "browse files"}
                <input type="file" multiple accept="audio/*,video/mp4" style={{ display: "none" }}
                  onChange={(e) => e.target.files && addFiles(e.target.files)} />
              </label>
            </div>
          </div>
        </div>

        {queue.length > 0 && variant === "A" && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
              {lang === "zh" ? `佇列 · ${queue.length}` : `Queue · ${queue.length}`}
            </div>
            <KCard pad={0}>
              {queue.map((q, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                  borderTop: i === 0 ? "none" : `1px solid ${cssVar.line}`,
                }}>
                  <KIcon name="waveform" size={14} color={cssVar.fg3} />
                  <div style={{ flex: 1, fontSize: 13 }}>{q.name}</div>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3 }}>
                    {(q.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <KBadge tone={q.status === "done" ? "ok" : q.status === "processing" ? "warn" : "neutral"}>
                    {q.status}
                  </KBadge>
                </div>
              ))}
            </KCard>
          </div>
        )}
      </div>
    </>
  );
}
