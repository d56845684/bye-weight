"use client";

import { useEffect, useRef, useState } from "react";
import { cssVar } from "@/lib/ds/theme";
import { KIcon } from "@/lib/ds/KIcon";
import { KWave } from "@/lib/ds/primitives";

// 片段播放器：按下 Play → seek 到 start_ms → 播到 end_ms 自動停。
// 若 audio_url 沒設或 seek 超過實際音檔長度，fallback 播全檔或顯示「音源不可用」。
// 多個 AudioClipPlayer 彼此獨立，按另一個會自動停上一個（view 層用 activeAudio ref 共享）。

let activeAudioEl: HTMLAudioElement | null = null;

export function AudioClipPlayer({
  audioUrl, startMs, endMs, label, compact,
}: {
  audioUrl: string | null;
  startMs: number;
  endMs: number;
  label?: string;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const clipDurMs = Math.max(0, endMs - startMs);

  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    if (activeAudioEl === el) activeAudioEl = null;
  };

  const play = async () => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    // 停掉其他正在播的 AudioClipPlayer
    if (activeAudioEl && activeAudioEl !== el) {
      activeAudioEl.pause();
    }
    activeAudioEl = el;
    // 若 seek 超過實際長度，退回從 0 播
    const seekSec = el.duration && startMs / 1000 >= el.duration
      ? 0
      : startMs / 1000;
    try {
      el.currentTime = seekSec;
      await el.play();
      setPlaying(true);
    } catch (e) {
      setErr("audio playback failed");
      setPlaying(false);
    }
  };

  // 到達 end_ms 自動停
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      if (!playing) return;
      // 用 seek 後相對時間判斷
      const curMs = el.currentTime * 1000;
      if (curMs >= Math.min(endMs, (el.duration || Infinity) * 1000)) {
        stop();
      }
    };
    const onEnded = () => stop();
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("ended", onEnded);
    };
  }, [playing, endMs]);

  if (!audioUrl) {
    return (
      <div style={{ ...rowStyle, opacity: 0.55 }}>
        <div style={{ ...btnStyle, background: cssVar.ink3, cursor: "not-allowed" }}>
          <KIcon name="play" size={compact ? 11 : 13} color={cssVar.fg4} />
        </div>
        <div style={{ flex: 1, fontSize: 11, color: cssVar.fg4, fontFamily: "var(--font-mono, monospace)" }}>
          {label || "audio unavailable"}
        </div>
      </div>
    );
  }

  return (
    <div style={rowStyle}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      <button
        type="button"
        onClick={playing ? stop : play}
        style={{
          ...btnStyle,
          background: cssVar.accent,
          width: compact ? 26 : 34, height: compact ? 26 : 34,
          borderRadius: compact ? 13 : 17,
        }}
      >
        <KIcon name={playing ? "pause" : "play"} size={compact ? 11 : 13} color={cssVar.accentInk} />
      </button>
      <div style={{ flex: 1 }}>
        <KWave bars={compact ? 24 : 40} height={compact ? 20 : 30} color={playing ? cssVar.accent : cssVar.fg3} />
      </div>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: compact ? 10 : 11, color: cssVar.fg3 }}>
        {formatMs(startMs)} → {formatMs(endMs)}  ·  {Math.round(clipDurMs / 100) / 10}s
      </span>
      {err && <span style={{ fontSize: 10, color: cssVar.danger }}>{err}</span>}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, width: "100%",
};

const btnStyle: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 17,
  border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  flex: "none",
};

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
