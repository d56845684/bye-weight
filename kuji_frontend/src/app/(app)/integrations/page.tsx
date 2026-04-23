"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { fetchAPI } from "@/lib/api";
import type { Integration, IntegrationProvider } from "@/lib/types";
import { cssVar } from "@/lib/ds/theme";
import { KBadge } from "@/lib/ds/primitives";
import { KIcon } from "@/lib/ds/KIcon";
import { IntegrationIcon, IntegrationKind } from "@/lib/ds/IntegrationIcon";
import { SettingsShell } from "@/components/SettingsShell";
import { ProviderDialog } from "@/components/ProviderDialog";

// Integrations — 點 chip / card 打開 ProviderDialog（彈窗）。
// OAuth callback 回來帶 ?connected=xxx，自動打開對應 provider 的設定視窗。

export default function IntegrationsPage() {
  const { variant, lang } = usePrefs();
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<Integration[]>([]);
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogKind, setDialogKind] = useState<string | null>(null);

  const refresh = () => Promise.all([
    fetchAPI<Integration[]>("/integrations"),
    fetchAPI<IntegrationProvider[]>("/integrations/providers"),
  ]).then(([i, p]) => { setItems(i); setProviders(p); setLoading(false); });

  useEffect(() => { refresh(); }, []);

  // OAuth 完成後帶 ?connected=xxx → 自動打開設定彈窗
  useEffect(() => {
    const connected = params.get("connected");
    if (connected && providers.length > 0) {
      setDialogKind(connected);
      router.replace("/integrations");
    }
  }, [params, providers, router]);

  const L = lang === "zh"
    ? { title: "整合", subA: "連接酷記與你的工作流工具", subB: "任務來源 → 酷記 → 目的地" }
    : { title: "Integrations", subA: "Connect Kuji with your workflow tools", subB: "Source → Kuji → Destination" };

  const activeProvider = dialogKind ? providers.find(p => p.kind === dialogKind) ?? null : null;
  const activeIntegration = dialogKind ? items.find(i => i.kind === dialogKind) ?? null : null;

  return (
    <SettingsShell active="integrations" title={L.title} subtitle={variant === "A" ? L.subA : L.subB}>
      {loading
        ? <div style={{ padding: 28, color: cssVar.fg3 }}>載入中…</div>
        : variant === "A"
          ? <Grid items={items} providers={providers} onOpen={setDialogKind} lang={lang} />
          : <Flow items={items} providers={providers} onOpen={setDialogKind} lang={lang} />
      }

      {activeProvider && (
        <ProviderDialog
          provider={activeProvider}
          integration={activeIntegration}
          onClose={() => setDialogKind(null)}
          onSaved={refresh}
        />
      )}
    </SettingsShell>
  );
}

// ═════════════════════════════════════════════════════════════════
// Variant A — card grid
// ═════════════════════════════════════════════════════════════════
function Grid({ items, providers, onOpen, lang }: {
  items: Integration[]; providers: IntegrationProvider[];
  onOpen: (k: string) => void; lang: "zh" | "en";
}) {
  const L = lang === "zh" ? { connect: "連接", manage: "管理" } : { connect: "Connect", manage: "Manage" };
  return (
    <div style={{ padding: 28, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, maxWidth: 900 }}>
      {providers.map(p => {
        const it = items.find(i => i.kind === p.kind);
        const connected = !!it?.connected;
        return (
          <button key={p.kind} onClick={() => onOpen(p.kind)} style={{
            padding: 18, background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10,
            cursor: "pointer", textAlign: "left", color: cssVar.fg,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8, flex: "none",
                background: cssVar.ink3, border: `1px solid ${cssVar.line}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: connected ? cssVar.accent : cssVar.fg3,
              }}>
                <IntegrationIcon name={p.kind as IntegrationKind} size={20} color={connected ? cssVar.accent : cssVar.fg3} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{p.display_name}</span>
                  {connected
                    ? <KBadge tone="ok">✓ {lang === "zh" ? "已連接" : "CONNECTED"}</KBadge>
                    : <KBadge tone="neutral">{lang === "zh" ? "未連接" : "NOT CONNECTED"}</KBadge>}
                </div>
                <div style={{ fontSize: 12.5, color: cssVar.fg2, lineHeight: 1.5, marginBottom: 10 }}>
                  {lang === "zh" ? p.description_zh : p.description_en}
                </div>
                {connected && it?.workspace_label && (
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: cssVar.fg3, marginBottom: 10 }}>
                    ↳ {it.workspace_label}
                  </div>
                )}
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  background: connected ? "transparent" : cssVar.accent,
                  color: connected ? cssVar.fg2 : cssVar.accentInk,
                  border: `1px solid ${connected ? cssVar.line2 : cssVar.accent}`,
                }}>
                  <KIcon name={connected ? "settings" : "plus"} size={12} />
                  {connected ? L.manage : L.connect}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Variant B — visual flow
// ═════════════════════════════════════════════════════════════════
function Flow({ items, providers, onOpen, lang }: {
  items: Integration[]; providers: IntegrationProvider[];
  onOpen: (k: string) => void; lang: "zh" | "en";
}) {
  const L = lang === "zh"
    ? { sources: "錄音來源", dest: "任務目的地", rules: "路由規則" }
    : { sources: "RECORDING SOURCES", dest: "TASK DESTINATIONS", rules: "ROUTING RULES" };

  const sources = providers.filter(p => p.category === "source");
  const dests   = providers.filter(p => p.category === "destination");

  const routingRules = [
    { label: lang === "zh" ? "#legal 相關提及 → Slack #legal"  : "Mentions of #legal → Slack #legal",      on: true },
    { label: lang === "zh" ? "帶有期限的任務 → Google Calendar" : "Tasks with deadlines → Google Calendar", on: true },
    { label: lang === "zh" ? "@Emma 指派 → Slack DM"             : "@Emma assignments → Slack DM",            on: false },
  ];

  return (
    <>
      <div style={{ padding: 32, display: "grid", gridTemplateColumns: "1fr 140px 1fr", gap: 20, alignItems: "center", maxWidth: 900 }}>
        <Col title={L.sources}>
          {sources.map(p => <Chip key={p.kind} provider={p} integration={items.find(i => i.kind === p.kind)} onOpen={onOpen} />)}
        </Col>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <DashedLine color={cssVar.line} />
          <div style={{
            width: 64, height: 64, borderRadius: 12,
            background: cssVar.accent, color: cssVar.accentInk,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, fontWeight: 800,
          }}>K</div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: cssVar.fg3 }}>PROCESSING</div>
          <DashedLine color={cssVar.accent} />
        </div>
        <Col title={L.dest}>
          {dests.map(p => <Chip key={p.kind} provider={p} integration={items.find(i => i.kind === p.kind)} onOpen={onOpen} />)}
        </Col>
      </div>

      <div style={{ padding: "0 32px 32px", maxWidth: 900 }}>
        <div style={{ padding: 18, background: cssVar.ink2, border: `1px solid ${cssVar.line}`, borderRadius: 10 }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
            {L.rules}
          </div>
          {routingRules.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 0", borderTop: i > 0 ? `1px solid ${cssVar.line}` : "none",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: r.on ? cssVar.ok : cssVar.fg4 }} />
              <span style={{ flex: 1, fontSize: 13, color: cssVar.fg }}>{r.label}</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: r.on ? cssVar.ok : cssVar.fg4 }}>{r.on ? "ON" : "OFF"}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: cssVar.fg3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Chip({ provider, integration, onOpen }: {
  provider: IntegrationProvider;
  integration: Integration | undefined;
  onOpen: (k: string) => void;
}) {
  const on = !!integration?.connected;
  return (
    <button onClick={() => onOpen(provider.kind)} style={{
      padding: "10px 12px",
      background: cssVar.ink2,
      border: `1px solid ${on ? "color-mix(in srgb, var(--k-accent) 40%, transparent)" : cssVar.line}`,
      borderRadius: 8,
      display: "flex", alignItems: "center", gap: 10,
      minWidth: 180, cursor: "pointer",
      textAlign: "left", color: cssVar.fg,
    }}>
      <IntegrationIcon name={provider.kind as IntegrationKind} size={18} color={on ? cssVar.accent : cssVar.fg3} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, color: cssVar.fg, fontWeight: 500 }}>{provider.display_name}</div>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: on ? cssVar.accent : cssVar.fg4 }}>
          {on ? "● ACTIVE" : "○ OFF"}
        </div>
      </div>
      <KIcon name="chevronRight" size={12} color={cssVar.fg3} />
    </button>
  );
}

function DashedLine({ color }: { color: string }) {
  return (
    <svg width="100%" height="4">
      <path d="M0 2h140" stroke={color} strokeDasharray="4 4" />
    </svg>
  );
}
