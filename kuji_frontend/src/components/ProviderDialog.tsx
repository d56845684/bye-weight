"use client";

import { useEffect, useState } from "react";
import { fetchAPI, ApiError } from "@/lib/api";
import type { Integration, IntegrationProvider, ProviderField, DynamicOption } from "@/lib/types";
import { cssVar } from "@/lib/ds/theme";
import { KIcon } from "@/lib/ds/KIcon";
import { IntegrationIcon, IntegrationKind } from "@/lib/ds/IntegrationIcon";
import { KBtn, KBadge } from "@/lib/ds/primitives";
import { usePrefs } from "@/lib/prefs";

// ProviderDialog — 外部整合設定彈窗。
// 兩個狀態：
//   未連接 → 顯示描述 + 「使用 {provider} 登入」(導去後端 /connect，後端再 redirect 到 provider OAuth)
//   已連接 → 動態渲染 provider.fields 表單，select 支援 dynamic_options_endpoint
//            提供「儲存」+「中斷連線」
//
// OAuth 流程：點連接 → window.location = '/kuji/api/v1/integrations/{kind}/connect'
// → 後端 302 到 provider 授權 → 使用者同意 → provider redirect 回 /callback → 後端
// 302 回 /kuji/integrations?connected={kind} → Integrations 頁偵測 query 自動打開此 dialog。

export function ProviderDialog({
  provider, integration, onClose, onSaved,
}: {
  provider: IntegrationProvider;
  integration: Integration | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = usePrefs();
  const isConnected = !!integration?.connected;

  return (
    <ModalShell onClose={onClose}>
      <Header provider={provider} isConnected={isConnected} lang={lang} />
      {isConnected
        ? <ConfigForm provider={provider} integration={integration!} onSaved={onSaved} onClose={onClose} lang={lang} />
        : <ConnectPrompt provider={provider} lang={lang} />
      }
    </ModalShell>
  );
}

// ────────────────────────────────────────────────────────────────
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520, maxHeight: "88vh",
          background: cssVar.ink2, border: `1px solid ${cssVar.line2}`, borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          color: cssVar.fg,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Header({ provider, isConnected, lang }: { provider: IntegrationProvider; isConnected: boolean; lang: "zh" | "en" }) {
  const desc = lang === "zh" ? provider.description_zh : provider.description_en;
  return (
    <div style={{ padding: "20px 24px", borderBottom: `1px solid ${cssVar.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10,
          background: cssVar.ink3, border: `1px solid ${cssVar.line}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: isConnected ? cssVar.accent : cssVar.fg3,
        }}>
          <IntegrationIcon name={provider.kind as IntegrationKind} size={22} color={isConnected ? cssVar.accent : cssVar.fg3} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{provider.display_name}</span>
            {isConnected
              ? <KBadge tone="ok">✓ {lang === "zh" ? "已連接" : "CONNECTED"}</KBadge>
              : <KBadge tone="neutral">{lang === "zh" ? "未連接" : "NOT CONNECTED"}</KBadge>}
          </div>
          {desc && (
            <div style={{ fontSize: 12.5, color: cssVar.fg3, marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 未連接 — OAuth 啟動
// ────────────────────────────────────────────────────────────────
function ConnectPrompt({ provider, lang }: { provider: IntegrationProvider; lang: "zh" | "en" }) {
  const start = () => {
    // 走完整 browser navigate，讓 backend 能 302 到 provider；返回時帶 ?connected=kind
    window.location.href = `/kuji/api/v1/integrations/${provider.kind}/connect`;
  };
  return (
    <div style={{ padding: "24px 24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 13, color: cssVar.fg2, lineHeight: 1.6 }}>
        {lang === "zh"
          ? `透過 OAuth 2.0 安全授權連接 ${provider.display_name}。你將會被導至 ${provider.display_name} 的登入頁完成授權，回到酷記後再選擇同步目標。`
          : `Connect ${provider.display_name} via OAuth 2.0. You'll be redirected to ${provider.display_name} to authorize; pick sync targets when you come back.`}
      </div>
      <div style={{
        padding: 12, background: cssVar.ink3, border: `1px solid ${cssVar.line}`, borderRadius: 8,
        fontSize: 11.5, color: cssVar.fg3, display: "flex", gap: 8, alignItems: "flex-start",
      }}>
        <KIcon name="shield" size={14} color={cssVar.fg3} />
        <span>
          {lang === "zh"
            ? "酷記只會取得完成任務整合所需的最少權限；任何時候都能在此頁中斷連接。"
            : "Kuji requests only the minimum scopes needed for task routing. You can disconnect anytime."}
        </span>
      </div>
      <KBtn primary full icon="arrowRight" onClick={start} style={{ padding: "12px 14px", fontSize: 14 }}>
        {lang === "zh" ? `使用 ${provider.display_name} 繼續` : `Continue with ${provider.display_name}`}
      </KBtn>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 已連接 — config form + disconnect
// ────────────────────────────────────────────────────────────────
function ConfigForm({
  provider, integration, onSaved, onClose, lang,
}: {
  provider: IntegrationProvider;
  integration: Integration;
  onSaved: () => void;
  onClose: () => void;
  lang: "zh" | "en";
}) {
  // 表單 state：從 integration.config 初始化
  const [values, setValues] = useState<Record<string, any>>(integration.config || {});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const save = async () => {
    setErr(null); setSaving(true);
    try {
      await fetchAPI(`/integrations/${provider.kind}`, {
        method: "PUT",
        body: JSON.stringify({ config: values }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "save failed");
    } finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!confirm(lang === "zh" ? `確定中斷與 ${provider.display_name} 的連接？` : `Disconnect ${provider.display_name}?`)) return;
    setDisconnecting(true);
    try {
      await fetchAPI(`/integrations/${provider.kind}/disconnect`, { method: "POST" });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "disconnect failed");
      setDisconnecting(false);
    }
  };

  return (
    <>
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {integration.workspace_label && (
          <div style={{
            padding: "8px 12px", marginBottom: 18,
            background: cssVar.accentSofter, border: `1px solid ${cssVar.line}`, borderRadius: 6,
            fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: cssVar.fg2,
          }}>
            ↳ {integration.workspace_label}
          </div>
        )}

        {provider.fields.length === 0 ? (
          <div style={{ color: cssVar.fg3, fontSize: 12.5, textAlign: "center", padding: 20 }}>
            {lang === "zh" ? "此 provider 尚未定義設定欄位。" : "No configuration fields for this provider."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {provider.fields.map(f => (
              <Field
                key={f.key}
                field={f}
                value={values[f.key]}
                providerKind={provider.kind}
                lang={lang}
                onChange={(v) => setValues(prev => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        )}

        {err && (
          <div style={{
            marginTop: 14, padding: "8px 12px",
            background: "color-mix(in srgb, var(--k-danger) 13%, transparent)",
            color: cssVar.danger, fontSize: 12, borderRadius: 6,
          }}>
            {err}
          </div>
        )}
      </div>

      <div style={{
        padding: "14px 24px", borderTop: `1px solid ${cssVar.line}`,
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <KBtn danger small icon="logout" onClick={disconnect} disabled={disconnecting}>
          {lang === "zh" ? "中斷連線" : "Disconnect"}
        </KBtn>
        <div style={{ flex: 1 }} />
        <KBtn small onClick={onClose}>{lang === "zh" ? "取消" : "Cancel"}</KBtn>
        <KBtn small primary icon="check" onClick={save} disabled={saving}>
          {saving ? "…" : (lang === "zh" ? "儲存" : "Save")}
        </KBtn>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// 單一欄位渲染
// ────────────────────────────────────────────────────────────────
function Field({
  field, value, onChange, providerKind, lang,
}: {
  field: ProviderField;
  value: any;
  onChange: (v: any) => void;
  providerKind: string;
  lang: "zh" | "en";
}) {
  const label = (lang === "zh" ? field.label_zh : field.label_en) ?? field.key;
  const hint = lang === "zh" ? field.hint_zh : field.hint_en;

  if (field.type === "info") {
    return (
      <div style={{
        padding: "10px 12px", background: cssVar.ink3,
        border: `1px solid ${cssVar.line}`, borderRadius: 6,
        fontSize: 12, color: cssVar.fg3, lineHeight: 1.55,
      }}>
        <KIcon name="info" size={12} /> {label}
      </div>
    );
  }

  if (field.type === "checkbox") {
    const checked = !!value;
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: cssVar.accent }}
        />
        <span style={{ fontSize: 13, color: cssVar.fg, flex: 1 }}>{label}</span>
      </label>
    );
  }

  return (
    <div>
      <div style={{
        fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3,
        marginBottom: 6,
      }}>
        {label}{field.required && <span style={{ color: cssVar.danger, marginLeft: 4 }}>*</span>}
      </div>

      {field.type === "select" && field.dynamic_options_endpoint ? (
        <DynamicSelect endpoint={field.dynamic_options_endpoint} value={value ?? ""} onChange={onChange} lang={lang} />
      ) : field.type === "select" ? (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={selectStyle}
        >
          <option value="">—</option>
          {(field.options || []).map(o => (
            <option key={o.value} value={o.value}>
              {(lang === "zh" ? o.label_zh : o.label_en) ?? o.value}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          rows={4}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
        />
      ) : (
        <input
          type={field.type === "password" ? "password" : field.type === "url" ? "url" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          style={inputStyle}
        />
      )}

      {hint && (
        <div style={{ fontSize: 11, color: cssVar.fg4, marginTop: 5 }}>{hint}</div>
      )}
    </div>
  );
}

function DynamicSelect({ endpoint, value, onChange, lang }: {
  endpoint: string; value: string; onChange: (v: string) => void; lang: "zh" | "en";
}) {
  const [options, setOptions] = useState<DynamicOption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAPI<{ options: DynamicOption[] }>(endpoint)
      .then(r => { if (!cancelled) setOptions(r.options); })
      .catch(e => { if (!cancelled) setErr(e.message || "failed to load"); });
    return () => { cancelled = true; };
  }, [endpoint]);

  if (err) return <div style={{ fontSize: 12, color: cssVar.danger }}>{err}</div>;
  if (options === null) return <div style={{ fontSize: 12, color: cssVar.fg4 }}>{lang === "zh" ? "載入選項中…" : "Loading options…"}</div>;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
      <option value="">{lang === "zh" ? "— 請選擇 —" : "— pick one —"}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}{o.hint ? `  ·  ${o.hint}` : ""}
        </option>
      ))}
    </select>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  background: cssVar.ink3, border: `1px solid ${cssVar.line2}`, borderRadius: 7,
  fontSize: 13, color: cssVar.fg, outline: "none",
};
const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: "auto",
};
