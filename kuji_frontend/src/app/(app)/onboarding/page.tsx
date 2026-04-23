"use client";

import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBtn } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";

// Onboarding — A: 4-step wizard；B: single hero "try it first"。
export default function OnboardingPage() {
  const { variant, lang } = usePrefs();
  return variant === "A" ? <OnboardingA lang={lang} /> : <OnboardingB lang={lang} />;
}

function OnboardingA({ lang }: { lang: "zh" | "en" }) {
  const router = useRouter();
  const L = lang === "zh"
    ? { title: "歡迎使用 酷記", sub: "3 分鐘完成設定，讓 AI 開始幫你記會議" }
    : { title: "Welcome to Kuji", sub: "3 minutes to get set up" };
  const steps = lang === "zh" ? [
    { n: "01", t: "建立團隊", d: "邀請你的核心團隊成員", done: true },
    { n: "02", t: "連接第一個會議工具", d: "Zoom · Google Meet · Teams", done: true },
    { n: "03", t: "設定任務目的地", d: "Notion · Slack · Calendar", done: false, active: true },
    { n: "04", t: "試一場會議", d: "錄音或上傳示範檔案", done: false },
  ] : [
    { n: "01", t: "Create team", d: "Invite core team members", done: true },
    { n: "02", t: "Connect meeting tool", d: "Zoom · Google Meet · Teams", done: true },
    { n: "03", t: "Set task destinations", d: "Notion · Slack · Calendar", done: false, active: true },
    { n: "04", t: "Try your first meeting", d: "Record or upload a sample", done: false },
  ];

  return (
    <div style={{
      flex: 1, overflow: "auto", color: cssVar.fg,
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "60px 32px", position: "relative",
    }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
          SETUP · 2 of 4
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: -1.2, lineHeight: 1.15, margin: "0 0 10px" }}>{L.title}</h1>
        <p style={{ fontSize: 15, color: cssVar.fg2, marginBottom: 36, lineHeight: 1.55 }}>{L.sub}</p>

        {/* progress bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 40 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              height: 4, borderRadius: 2,
              background: s.done ? cssVar.accent : s.active ? cssVar.accentSoft : cssVar.line,
            }} />
          ))}
        </div>

        {/* steps list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 14, padding: 18,
              background: s.active ? cssVar.accentSoft : cssVar.ink2,
              border: `1px solid ${s.active ? cssVar.accent : cssVar.line}`, borderRadius: 10,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 12,
                background: s.done ? cssVar.accent : "transparent",
                border: `1.5px solid ${s.done ? cssVar.accent : cssVar.line2}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {s.done
                  ? <KIcon name="check" size={12} color={cssVar.accentInk} />
                  : <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3 }}>{s.n}</span>
                }
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{s.t}</div>
                <div style={{ fontSize: 12, color: cssVar.fg3 }}>{s.d}</div>
              </div>
              {s.active && <KBtn small primary>{lang === "zh" ? "開始" : "Start"} →</KBtn>}
              {s.done && (
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.ok }}>
                  ✓ {lang === "zh" ? "完成" : "Done"}
                </span>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <KBtn small ghost onClick={() => router.push("/board")}>
            {lang === "zh" ? "略過設定" : "Skip setup"}
          </KBtn>
          <KBtn small primary onClick={() => router.push("/board")}>
            {lang === "zh" ? "下一步" : "Continue"} →
          </KBtn>
        </div>
      </div>
    </div>
  );
}

function OnboardingB({ lang }: { lang: "zh" | "en" }) {
  const router = useRouter();
  return (
    <div style={{
      flex: 1, overflow: "auto", color: cssVar.fg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 40, position: "relative",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--k-accent) 13%, transparent), transparent 55%)", pointerEvents: "none" }} />

      <div style={{
        position: "relative", width: "100%", maxWidth: 560, textAlign: "center",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: cssVar.accent, color: cssVar.accentInk,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 26,
        }}>K</div>
        <div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
            {lang === "zh" ? "從第一場會議開始" : "Start with your first meeting"}
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1.4, lineHeight: 1.15, margin: "0 0 16px" }}>
            {lang === "zh" ? "要不要先看看 " : "Want to see "}
            <span style={{ color: cssVar.fg3 }}>
              {lang === "zh" ? "AI 能從你的會議裡抽出什麼？" : "what AI pulls from your meeting?"}
            </span>
          </h1>
          <p style={{ fontSize: 15, color: cssVar.fg2, lineHeight: 1.55 }}>
            {lang === "zh"
              ? "設定我們稍後再處理。先丟一個音檔或開始錄音，看看酷記怎麼把對話變成任務。"
              : "Setup can wait. Drop a file or hit record — see Kuji turn talk into tasks."}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%", marginTop: 8 }}>
          <button onClick={() => router.push("/record")} style={{
            padding: 24, background: cssVar.ink2,
            border: `1.5px solid ${cssVar.accent}`, borderRadius: 12,
            cursor: "pointer", textAlign: "left", color: cssVar.fg,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: cssVar.accentSoft, color: cssVar.accent,
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
            }}><KIcon name="mic" size={20} /></div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
              {lang === "zh" ? "開始錄音" : "Record now"}
            </div>
            <div style={{ fontSize: 12, color: cssVar.fg3 }}>
              {lang === "zh" ? "現場會議 · 即時轉寫" : "Live meeting · real-time"}
            </div>
          </button>
          <button onClick={() => router.push("/upload")} style={{
            padding: 24, background: cssVar.ink2,
            border: `1px solid ${cssVar.line}`, borderRadius: 12,
            cursor: "pointer", textAlign: "left", color: cssVar.fg,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: cssVar.ink3, color: cssVar.fg2,
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
            }}><KIcon name="upload" size={20} /></div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
              {lang === "zh" ? "上傳音檔" : "Upload audio"}
            </div>
            <div style={{ fontSize: 12, color: cssVar.fg3 }}>
              {lang === "zh" ? "過往會議 · 批次處理" : "Past meeting · batch"}
            </div>
          </button>
        </div>

        <KBtn ghost small onClick={() => router.push("/meetings")} style={{ marginTop: 8 }}>
          {lang === "zh" ? "先看示範會議 →" : "See sample meeting →"}
        </KBtn>
      </div>
    </div>
  );
}
