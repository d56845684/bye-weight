"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { cssVar } from "@/lib/ds/theme";
import { KBtn } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { TweaksPanel } from "@/components/TweaksPanel";

// 註冊頁 — MVP：form 收資料、送出顯示「待管理員核准」，不真的建帳號。
// 對齊設計 LoginA / LoginB 的視覺語彙（同一組 tokens、字型、layout）。
export default function SignupPage() {
  const { variant, lang } = usePrefs();
  return (
    <>
      <TweaksPanel />
      {variant === "A" ? <SignupA lang={lang} /> : <SignupB lang={lang} />}
    </>
  );
}

function useSignupForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [team, setTeam] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email || !password || !name) {
      setErr("email / 姓名 / 密碼必填");
      return;
    }
    setBusy(true);
    // MVP：先 stub — 實際會 POST /auth/v1/public-signup 或 /kuji/api/v1/signup
    // 真正接 ASR 前先讓 UI 走一圈
    await new Promise(r => setTimeout(r, 600));
    setDone(true);
    setBusy(false);
  };
  return { email, setEmail, name, setName, password, setPassword, team, setTeam, done, busy, err, submit };
}

function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.27,
      background: cssVar.accent, color: cssVar.accentInk,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: size * 0.58,
    }}>K</div>
  );
}

function SignupA({ lang }: { lang: "zh" | "en" }) {
  const L = lang === "zh" ? {
    title: "建立酷記帳號", sub: "免信用卡 · 前 600 分鐘免費",
    name: "姓名", team: "團隊 / 公司（選填）", email: "工作 Email", pw: "密碼",
    create: "建立帳號", haveAcc: "已經有帳號？", loginCta: "登入",
    features: ["中英混說辨識", "行動事項自動抽取", "Notion · Slack · Calendar 整合"],
    doneTitle: "申請已送出", doneSub: "管理員審核通過後會寄確認信到你的 Email。",
  } : {
    title: "Create your Kuji account", sub: "No credit card · 600 free minutes",
    name: "Name", team: "Team / company (optional)", email: "Work email", pw: "Password",
    create: "Create account", haveAcc: "Already have an account?", loginCta: "Log in",
    features: ["Code-switched ASR", "Action-item extraction", "Notion · Slack · Calendar integrations"],
    doneTitle: "Request received", doneSub: "Admin will review and send a confirmation email shortly.",
  };
  const f = useSignupForm();

  return (
    <div style={{
      width: "100%", minHeight: "100vh", background: cssVar.ink, color: cssVar.fg,
      display: "grid", gridTemplateColumns: "1fr 1fr",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, position: "relative" }}>
        <div style={{ position: "absolute", top: 32, left: 32, display: "flex", alignItems: "center", gap: 8 }}>
          <LogoMark /><span style={{ fontWeight: 600 }}>{lang === "zh" ? "酷記" : "Kuji"}</span>
        </div>

        {f.done ? (
          <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: 28, margin: "0 auto 18px",
              background: cssVar.accentSoft, color: cssVar.accent,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <KIcon name="check" size={28} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.5, marginBottom: 8 }}>{L.doneTitle}</h1>
            <p style={{ fontSize: 14, color: cssVar.fg3, marginBottom: 24 }}>{L.doneSub}</p>
            <Link href="/login" style={{ color: cssVar.accent, fontSize: 13 }}>
              ← {lang === "zh" ? "回登入頁" : "Back to login"}
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); f.submit(); }} style={{ width: "100%", maxWidth: 380 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.8, marginBottom: 8 }}>{L.title}</h1>
            <p style={{ fontSize: 14, color: cssVar.fg3, marginBottom: 24 }}>{L.sub}</p>

            <Field label={L.name}  value={f.name}  onChange={f.setName} />
            <div style={{ height: 10 }} />
            <Field label={L.team}  value={f.team}  onChange={f.setTeam} />
            <div style={{ height: 10 }} />
            <Field label={L.email} value={f.email} onChange={f.setEmail} type="email" autoComplete="email" />
            <div style={{ height: 10 }} />
            <Field label={L.pw}    value={f.password} onChange={f.setPassword} type="password" autoComplete="new-password" />

            {f.err && <div style={{ marginTop: 12, color: cssVar.danger, fontSize: 12 }}>{f.err}</div>}
            <div style={{ height: 18 }} />
            <KBtn primary full type="submit" style={{ padding: "12px 14px", fontSize: 14 }}>
              {f.busy ? "…" : `${L.create} →`}
            </KBtn>
            <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: cssVar.fg3 }}>
              {L.haveAcc} <Link href="/login" style={{ color: cssVar.accent, textDecoration: "none" }}>{L.loginCta}</Link>
            </div>
          </form>
        )}
      </div>

      <div style={{
        background: cssVar.ink2, borderLeft: `1px solid ${cssVar.line}`, padding: 48,
        display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 20% 80%, color-mix(in srgb, var(--k-accent) 13%, transparent), transparent 55%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", maxWidth: 420 }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
            WHAT YOU&apos;LL GET
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1.3, marginBottom: 24 }}>
            {lang === "zh" ? "把每場會議變成可執行的計畫。" : "Turn every meeting into work that runs itself."}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {L.features.map(feat => (
              <div key={feat} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: cssVar.fg2 }}>
                <KIcon name="check" size={14} color={cssVar.accent} />
                {feat}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SignupB({ lang }: { lang: "zh" | "en" }) {
  const f = useSignupForm();
  return (
    <div style={{
      width: "100%", minHeight: "100vh", background: cssVar.ink, color: cssVar.fg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 40, position: "relative",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--k-accent) 8%, transparent), transparent 55%)" }} />

      {f.done ? (
        <div style={{ position: "relative", textAlign: "center", maxWidth: 360 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 28, margin: "0 auto 20px",
            background: cssVar.accentSoft, color: cssVar.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <KIcon name="check" size={28} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.6, marginBottom: 8 }}>
            {lang === "zh" ? "申請已送出" : "Request received"}
          </h1>
          <p style={{ fontSize: 13, color: cssVar.fg3, marginBottom: 24 }}>
            {lang === "zh" ? "審核通過後會寄確認信到你的 Email。" : "We'll send a confirmation email once approved."}
          </p>
          <Link href="/login" style={{ color: cssVar.accent, fontSize: 13 }}>
            ← {lang === "zh" ? "回登入頁" : "Back to login"}
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); f.submit(); }} style={{ position: "relative", width: "100%", maxWidth: 360, textAlign: "center" }}>
          <div style={{ marginBottom: 24 }}><LogoMark size={44} /></div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.6, marginBottom: 8 }}>
            {lang === "zh" ? "建立帳號" : "Create account"}
          </h1>
          <p style={{ fontSize: 13, color: cssVar.fg3, marginBottom: 24 }}>
            {lang === "zh" ? "3 個欄位，30 秒完成" : "3 fields, 30 seconds"}
          </p>
          <Field label={lang === "zh" ? "姓名" : "NAME"}  value={f.name}  onChange={f.setName} />
          <div style={{ height: 10 }} />
          <Field label="EMAIL" value={f.email} onChange={f.setEmail} type="email" autoComplete="email" showFocusGlow />
          <div style={{ height: 10 }} />
          <Field label={lang === "zh" ? "密碼" : "PASSWORD"} value={f.password} onChange={f.setPassword} type="password" autoComplete="new-password" />
          {f.err && <div style={{ marginTop: 10, color: cssVar.danger, fontSize: 12 }}>{f.err}</div>}
          <div style={{ height: 16 }} />
          <KBtn primary full type="submit" style={{ padding: "12px 14px", fontSize: 14 }} icon="arrowRight">
            {f.busy ? "…" : (lang === "zh" ? "送出" : "Continue")}
          </KBtn>
          <div style={{ marginTop: 20, fontSize: 12.5, color: cssVar.fg3 }}>
            {lang === "zh" ? "已經有帳號？" : "Have an account?"} <Link href="/login" style={{ color: cssVar.accent, textDecoration: "none" }}>{lang === "zh" ? "登入" : "Log in"}</Link>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", autoComplete, showFocusGlow }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; autoComplete?: string; showFocusGlow?: boolean;
}) {
  return (
    <div style={{ textAlign: "left" }}>
      <div style={{
        fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, marginBottom: 6,
      }}>
        {label}
      </div>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "11px 14px", background: cssVar.ink2,
          border: `1px solid ${showFocusGlow ? cssVar.accent : cssVar.line2}`,
          borderRadius: 8, fontSize: 14, color: cssVar.fg, outline: "none",
        }}
      />
    </div>
  );
}
