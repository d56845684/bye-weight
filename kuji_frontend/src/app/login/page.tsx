"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cssVar } from "@/lib/ds/theme";
import { KBtn } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { usePrefs } from "@/lib/prefs";
import { passwordLogin, ApiError } from "@/lib/api";
import { TweaksPanel } from "@/components/TweaksPanel";

export default function LoginPage() {
  const { variant, lang } = usePrefs();
  return (
    <>
      <TweaksPanel />
      {variant === "A" ? <LoginA lang={lang} /> : <LoginB lang={lang} />}
    </>
  );
}

function useLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("emily@acme.com");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await passwordLogin(email, password);
      // Next.js basePath="/kuji"：router.push 不要帶前綴，否則會變 /kuji/kuji/board
      router.push("/board");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "登入失敗");
    } finally {
      setLoading(false);
    }
  };
  return { email, setEmail, password, setPassword, error, loading, submit };
}

function LoginA({ lang }: { lang: "zh" | "en" }) {
  const L = lang === "zh" ? {
    title: "登入 酷記", sub: "繼續你上次的會議整理",
    email: "Email", pw: "密碼", login: "登入", or: "or",
    google: "使用 Google 繼續", ms: "使用 Microsoft 繼續",
    forgot: "忘記密碼？", signup: "還沒註冊？", signupCta: "免費註冊",
    week: "THIS WEEK ON KUJI",
    quote: "「28 場會議 · 142 個任務 · 全部已同步。」",
    meetings: "meetings", tasks: "tasks", routed: "routed",
  } : {
    title: "Log in to Kuji", sub: "Pick up where you left off",
    email: "Email", pw: "Password", login: "Log in", or: "or",
    google: "Continue with Google", ms: "Continue with Microsoft",
    forgot: "Forgot password?", signup: "New here?", signupCta: "Sign up free",
    week: "THIS WEEK ON KUJI",
    quote: "\"28 meetings · 142 tasks · all synced.\"",
    meetings: "meetings", tasks: "tasks", routed: "routed",
  };
  const { email, setEmail, password, setPassword, error, loading, submit } = useLogin();

  return (
    <div style={{
      width: "100%", minHeight: "100vh", background: cssVar.ink, color: cssVar.fg,
      display: "grid", gridTemplateColumns: "1fr 1fr",
    }}>
      {/* 左：form */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, position: "relative" }}>
        <div style={{ position: "absolute", top: 32, left: 32, display: "flex", alignItems: "center", gap: 8 }}>
          <LogoMark />
          <span style={{ fontWeight: 600 }}>{lang === "zh" ? "酷記" : "Kuji"}</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ width: "100%", maxWidth: 380 }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.8, marginBottom: 8 }}>{L.title}</h1>
          <p style={{ fontSize: 14, color: cssVar.fg3, marginBottom: 28 }}>{L.sub}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <SSOButton disabled>
              <GoogleG />{L.google}
            </SSOButton>
            <SSOButton disabled>
              <MSSquares />{L.ms}
            </SSOButton>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0", fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4, letterSpacing: 1 }}>
            <div style={{ flex: 1, height: 1, background: cssVar.line }} />{L.or}<div style={{ flex: 1, height: 1, background: cssVar.line }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            <Field
              label={L.email}
              value={email}
              onChange={setEmail}
              autoComplete="username"
              type="email"
            />
            <Field
              label={L.pw}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              type="password"
              hint={<span style={{ color: cssVar.accent, cursor: "pointer" }}>{L.forgot}</span>}
            />
          </div>
          {error && <div style={{ background: "color-mix(in srgb, var(--k-danger) 13%, transparent)", color: cssVar.danger, fontSize: 12, padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>{error}</div>}
          <KBtn primary full type="submit" style={{ padding: "12px 14px", fontSize: 14 }}>
            {loading ? "…" : `${L.login} →`}
          </KBtn>
          <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: cssVar.fg3 }}>
            {L.signup} <Link href="/signup" style={{ color: cssVar.accent, textDecoration: "none" }}>{L.signupCta}</Link>
          </div>
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 11, color: cssVar.fg4, fontFamily: "var(--font-mono, monospace)" }}>
            DEV: emily@acme.com / demo123
          </div>
        </form>
      </div>
      {/* 右：marketing */}
      <div style={{
        background: cssVar.ink2, borderLeft: `1px solid ${cssVar.line}`, padding: 48,
        display: "flex", flexDirection: "column", justifyContent: "center",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 80% 20%, color-mix(in srgb, var(--k-accent) 13%, transparent), transparent 50%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", maxWidth: 420 }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>{L.week}</div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1.25, marginBottom: 28 }}>{L.quote}</div>
          <div style={{ display: "flex", gap: 20, fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: cssVar.fg3 }}>
            <div><div style={{ fontSize: 28, color: cssVar.fg }}>28</div>{L.meetings}</div>
            <div><div style={{ fontSize: 28, color: cssVar.fg }}>142</div>{L.tasks}</div>
            <div><div style={{ fontSize: 28, color: cssVar.accent }}>96%</div>{L.routed}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginB({ lang }: { lang: "zh" | "en" }) {
  const { email, setEmail, password, setPassword, error, loading, submit } = useLogin();
  return (
    <div style={{
      width: "100%", minHeight: "100vh", background: cssVar.ink, color: cssVar.fg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 40, position: "relative",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--k-accent) 8%, transparent), transparent 55%)" }} />
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ position: "relative", width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ marginBottom: 24 }}><LogoMark size={44} /></div>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.6, marginBottom: 8 }}>
          {lang === "zh" ? "登入 酷記" : "Log in"}
        </h1>
        <p style={{ fontSize: 13, color: cssVar.fg3, marginBottom: 24 }}>
          {lang === "zh" ? "用 email + 密碼登入；或聯絡管理員取得 Google / MS SSO 綁定。" : "Sign in with email + password."}
        </p>
        <Field label="EMAIL" value={email} onChange={setEmail} type="email" autoComplete="username" showFocusGlow />
        <div style={{ height: 10 }} />
        <Field label={lang === "zh" ? "密碼" : "PASSWORD"} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
        {error && <div style={{ marginTop: 10, color: cssVar.danger, fontSize: 12 }}>{error}</div>}
        <div style={{ height: 16 }} />
        <KBtn primary full type="submit" style={{ padding: "12px 14px", fontSize: 14 }} icon="arrowRight">
          {loading ? "…" : (lang === "zh" ? "登入" : "Continue")}
        </KBtn>
        <div style={{ margin: "24px 0", fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg4, letterSpacing: 1 }}>— OR —</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {["G", "MS", "GH"].map(s => (
            <button key={s} disabled style={{
              width: 44, height: 44, borderRadius: 10,
              background: cssVar.ink2, border: `1px solid ${cssVar.line2}`,
              color: cssVar.fg3, cursor: "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-mono, monospace)", fontSize: 10,
            }}>{s}</button>
          ))}
        </div>
        <div style={{ marginTop: 20, fontSize: 11, color: cssVar.fg4, fontFamily: "var(--font-mono, monospace)" }}>
          DEV: emily@acme.com / demo123
        </div>
      </form>
    </div>
  );
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

function Field({ label, value, onChange, type = "text", autoComplete, hint, showFocusGlow }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; autoComplete?: string; hint?: React.ReactNode; showFocusGlow?: boolean;
}) {
  return (
    <div style={{ textAlign: "left" }}>
      <div style={{
        fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3,
        marginBottom: 6, display: "flex", justifyContent: "space-between",
      }}>
        {label}{hint}
      </div>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "11px 14px",
          background: cssVar.ink2,
          border: `1px solid ${showFocusGlow ? cssVar.accent : cssVar.line2}`,
          borderRadius: 8, fontSize: 14,
          color: cssVar.fg, outline: "none",
        }}
      />
    </div>
  );
}

function SSOButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} style={{
      padding: "11px 14px", background: cssVar.ink2,
      border: `1px solid ${cssVar.line2}`, borderRadius: 8,
      color: cssVar.fg, fontSize: 13,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      {children}
    </button>
  );
}

function GoogleG() {
  return <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z"/></svg>;
}
function MSSquares() {
  return <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#f25022" d="M2 2h10v10H2z"/><path fill="#7fba00" d="M12 2h10v10H12z"/><path fill="#00a4ef" d="M2 12h10v10H2z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>;
}
