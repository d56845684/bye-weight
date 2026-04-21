"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

// Direction B Body tab：InBody 最新紀錄 + 8 格 metric grid。
// 資料來源：/inbody/me/summary（Phase 2 後端已算好 prev + deltas）。

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
};

type Metric = { zh: string; en: string; v: number | null; prev: number | null; u: string; decimals: number };

export default function PatientInbodyPage() {
  const [data, setData] = useState<InbodySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<InbodySummary>("/inbody/me/summary?days=30")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 py-8 text-center text-sm">載入中…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-3 rounded text-sm">錯誤：{err}</div>;
  if (!data?.latest) {
    return (
      <div className="flex flex-col gap-3.5">
        <Header date={null} />
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="text-sm text-gray-500">尚無 InBody 紀錄</div>
          <div className="text-xs text-gray-400 mt-1">診所測量後會自動同步至此</div>
        </div>
      </div>
    );
  }

  const l = data.latest;
  const metrics: Metric[] = [
    { zh: "體重",     en: "Weight",   v: l.weight,          prev: l.weight_prev,         u: "kg",   decimals: 1 },
    { zh: "BMI",     en: "BMI",      v: l.bmi,             prev: l.bmi_prev,            u: "",     decimals: 1 },
    { zh: "體脂率",   en: "Body Fat", v: l.body_fat_pct,    prev: l.body_fat_pct_prev,   u: "%",    decimals: 1 },
    { zh: "骨骼肌",   en: "Muscle",   v: l.muscle_mass,     prev: l.muscle_mass_prev,    u: "kg",   decimals: 1 },
    { zh: "內臟脂肪", en: "Visceral", v: l.visceral_fat,    prev: l.visceral_fat_prev,   u: "lvl",  decimals: 0 },
    { zh: "基礎代謝", en: "BMR",      v: l.metabolic_rate,  prev: l.metabolic_rate_prev, u: "kcal", decimals: 0 },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Header date={l.measured_at} />
      <div className="grid grid-cols-2 gap-2.5">
        {metrics.map((m) => (
          <MetricCard key={m.en} m={m} />
        ))}
      </div>
      <div className="bg-white rounded-2xl p-4 text-center">
        <div className="text-[11px] text-gray-400 font-mono">SEGMENTAL · 分部位分析</div>
        <div className="text-xs text-gray-400 mt-2 leading-relaxed">
          手臂 / 軀幹 / 腿部 肌肉脂肪分佈
          <br />
          <span className="text-gray-300">(將於後續版本自 InBody 報告自動解析)</span>
        </div>
      </div>
    </div>
  );
}

function Header({ date }: { date: string | null }) {
  return (
    <div>
      <div className="text-[22px] font-bold tracking-tight">InBody 身體組成</div>
      <div className="text-[11px] text-gray-500 font-mono">
        {date ? `LATEST · ${date.slice(0, 10).replace(/-/g, ".")}` : "NO DATA"}
      </div>
    </div>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const d = m.v !== null && m.prev !== null ? m.v - m.prev : null;
  // 體脂 / 體重 / BMI / 內臟脂肪 下降是好事（teal）；肌肉 / BMR 上升是好事
  const downIsGood = ["Weight", "Body Fat", "BMI", "Visceral"].includes(m.en);
  const good = d !== null ? (downIsGood ? d < 0 : d > 0) : false;
  return (
    <div className="bg-white rounded-xl p-3">
      <div className="text-[10px] font-mono uppercase text-gray-400">{m.en}</div>
      <div className="text-[11px] text-gray-500">{m.zh}</div>
      <div className="flex items-baseline gap-1 mt-1.5">
        <div className="text-[20px] font-bold font-mono">
          {m.v !== null ? m.v.toFixed(m.decimals) : "—"}
        </div>
        <div className="text-[10px] text-gray-400">{m.u}</div>
        {d !== null && (
          <div className={`ml-auto text-[10px] font-mono font-semibold ${good ? "text-teal-600" : "text-orange-600"}`}>
            {d > 0 ? "+" : ""}{d.toFixed(m.decimals)}
          </div>
        )}
      </div>
    </div>
  );
}
