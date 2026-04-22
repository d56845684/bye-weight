"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, fetchAPI } from "@/lib/api";
import { LineChart } from "@/components/charts";

// Direction B Home（精簡版）：greeting + 體重 hero + 3 quick stats + 跳轉入口。
// 只抓 2 支 summary（/patients/me + /inbody/me/summary）；飲食與看診的細節等
// 使用者點底部 tab 進去才載入（lazy），降低首頁 TTFB + 首屏資料量。

type InbodySummary = {
  latest: {
    measured_at: string;
    weight: number | null; weight_prev: number | null;
    bmi: number | null; bmi_prev: number | null;
    body_fat_pct: number | null; body_fat_pct_prev: number | null;
    muscle_mass: number | null; muscle_mass_prev: number | null;
    visceral_fat: number | null; visceral_fat_prev: number | null;
    metabolic_rate: number | null; metabolic_rate_prev: number | null;
  } | null;
  series: { dates: string[]; weight: (number | null)[] };
};

type Me = { name: string; chart_no: string | null };

export default function PatientHome() {
  const [me, setMe] = useState<Me | null>(null);
  const [inbody, setInbody] = useState<InbodySummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [m, i] = await Promise.allSettled([
          fetchAPI<Me>("/patients/me"),
          fetchAPI<InbodySummary>("/inbody/me/summary?days=30"),
        ]);
        if (m.status === "fulfilled") setMe(m.value);
        if (i.status === "fulfilled") setInbody(i.value);
        // /me 掛了代表沒 profile → LIFF 頁面會再處理；這裡只 show msg
        if (m.status === "rejected" && m.reason instanceof ApiError && m.reason.status === 404) {
          setErr("尚未建立病患資料，請回 LIFF 首頁完成註冊。");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = new Date();
  const dateLabel = today.toLocaleDateString("zh-TW", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const greeting = greetingByHour(today.getHours());

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <div className="text-[11px] text-gray-500 font-mono">{dateLabel}</div>
        <div className="text-2xl font-bold tracking-tight mt-0.5">
          {greeting}，{me?.name ?? "使用者"}
        </div>
        {err && <div className="mt-2 text-xs text-red-700 bg-red-50 rounded p-2">{err}</div>}
      </div>

      {/* Weight hero — teal gradient card */}
      {inbody?.latest ? (
        <WeightHero inbody={inbody} />
      ) : (
        <EmptyCard title="體重" hint={loading ? "載入中…" : "尚無 InBody 紀錄，診所上傳後會顯示"} />
      )}

      {/* 3 quick stats */}
      {inbody?.latest && <QuickStats latest={inbody.latest} />}

      {/* Quick entry tiles — 點進去才載入各自 tab 的資料 */}
      <QuickEntries />
    </div>
  );
}

function WeightHero({ inbody }: { inbody: InbodySummary }) {
  const l = inbody.latest!;
  const delta = l.weight !== null && l.weight_prev !== null ? l.weight_prev - l.weight : null;
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 text-white"
         style={{ background: "linear-gradient(145deg, #0d9488, #0f766e)" }}>
      <div className="absolute -right-5 -top-5 w-32 h-32 rounded-full bg-white/10" />
      <div className="text-[11px] uppercase tracking-[0.04em] opacity-75 font-mono">
        CURRENT WEIGHT · {l.measured_at.slice(0, 10)}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <div className="text-[40px] font-bold tracking-tight font-mono leading-none">
          {l.weight?.toFixed(1) ?? "—"}
        </div>
        <div className="text-sm opacity-80">kg</div>
        {delta !== null && (
          <div className="ml-auto text-xs opacity-90 bg-white/20 px-2.5 py-1 rounded-xl font-mono">
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(1)} kg
          </div>
        )}
      </div>
      <div className="mt-3.5 opacity-95">
        <LineChart
          data={inbody.series.weight}
          dates={inbody.series.dates}
          width={320}
          height={70}
          color="#ffffff"
          textColor="rgba(255,255,255,0.6)"
          gridColor="rgba(255,255,255,0.12)"
          pad={{ t: 6, r: 4, b: 18, l: 4 }}
          showGrid={false}
          showDots={false}
        />
      </div>
    </div>
  );
}

function QuickStats({ latest }: { latest: NonNullable<InbodySummary["latest"]> }) {
  const stats = [
    { zh: "體脂率", en: "Fat",    v: latest.body_fat_pct, prev: latest.body_fat_pct_prev, u: "%" },
    { zh: "BMI",   en: "BMI",    v: latest.bmi,          prev: latest.bmi_prev,          u: ""  },
    { zh: "肌肉量", en: "Muscle", v: latest.muscle_mass,  prev: latest.muscle_mass_prev,  u: "kg" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {stats.map((k) => {
        const d = k.v !== null && k.prev !== null ? k.v - k.prev : null;
        return (
          <div key={k.en} className="bg-white rounded-xl p-3">
            <div className="text-[10px] font-mono uppercase text-gray-400">{k.en}</div>
            <div className="text-[11px] text-gray-500">{k.zh}</div>
            <div className="text-[20px] font-bold mt-1.5 font-mono tracking-tight">
              {k.v?.toFixed(1) ?? "—"}
              <span className="text-[10px] text-gray-400 font-normal ml-0.5">{k.u}</span>
            </div>
            {d !== null ? (
              <div className={`text-[10px] font-mono mt-0.5 ${d > 0 ? "text-orange-600" : "text-teal-600"}`}>
                {d > 0 ? "+" : ""}{d.toFixed(1)}
              </div>
            ) : <div className="text-[10px] text-gray-300 mt-0.5">—</div>}
          </div>
        );
      })}
    </div>
  );
}

// 首頁不自己抓其他 tab 的資料，而是給使用者點按，進去後才 lazy load。
// prefetch={false} 避免 Next.js 預取其他 tab 的 chunk / 連帶 fetch。
const QUICK_ENTRIES: { href: string; zh: string; en: string; icon: string; color: string }[] = [
  { href: "/patient/inbody",    zh: "InBody",    en: "BODY",   icon: "M12 2a3 3 0 110 6 3 3 0 010-6zM8 22v-8l-3-2v-5l4 1 3-1 3 1 4-1v5l-3 2v8", color: "#0d9488" },
  { href: "/patient/food-logs", zh: "飲食紀錄", en: "DIET",   icon: "M6 2v9a3 3 0 003 3v8M10 2v5a2 2 0 01-4 0V2M16 22V2c-2 0-4 3-4 7s2 6 4 6v7",     color: "#f59e0b" },
  { href: "/patient/visits",    zh: "看診紀錄", en: "VISITS", icon: "M4 5h16v14H4zM4 9h16M8 13h4",                                                     color: "#a78bfa" },
  { href: "/patient/trends",    zh: "趨勢圖表", en: "TRENDS", icon: "M3 18l6-6 4 4 8-10",                                                              color: "#0f766e" },
];

function QuickEntries() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {QUICK_ENTRIES.map((e) => (
        <Link
          key={e.href}
          href={e.href}
          prefetch={false}
          className="bg-white rounded-xl p-4 flex items-center gap-3 hover:shadow-sm active:bg-gray-50 transition-colors"
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${e.color}1a`, color: e.color }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={e.icon} />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase text-gray-400">{e.en}</div>
            <div className="text-sm font-semibold">{e.zh}</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" className="text-gray-300">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      ))}
    </div>
  );
}

function EmptyCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="bg-white rounded-2xl p-5">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-gray-400 mt-1">{hint}</div>
    </div>
  );
}

function greetingByHour(h: number): string {
  if (h < 5 || h >= 22) return "晚安";
  if (h < 12) return "早安";
  if (h < 18) return "午安";
  return "晚安";
}
