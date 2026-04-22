"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAPI } from "@/lib/api";
import { BodyMap } from "@/components/BodyMap";

// Direction B Body tab：InBody 紀錄 + 10 格 metric grid + 分部位示意圖。
// 頂部可從 dropdown 選過去任一次測量；delta 針對「選定 record vs 再前一筆」計算。
// 資料來源：/inbody/me/summary（Phase 2/3 後端吐 latest + series + records list）。

type Segmental = {
  la: number | null; ra: number | null; tr: number | null;
  ll: number | null; rl: number | null;
};

type InbodyRecord = {
  id: number;
  measured_at: string;
  weight: number | null; bmi: number | null; body_fat_pct: number | null;
  muscle_mass: number | null; visceral_fat: number | null; metabolic_rate: number | null;
  body_age: number | null;
  total_body_water: number | null; protein_mass: number | null; mineral_mass: number | null;
  muscle_segmental: Segmental | null; fat_segmental: Segmental | null;
};

type InbodySummary = {
  records: InbodyRecord[];   // desc by measured_at；[0] = 最新
};

type Metric = {
  zh: string;
  en: string;
  v: number | null;
  prev: number | null;
  u: string;
  decimals: number;
  downIsGood: boolean;
};

export default function PatientInbodyPage() {
  const [data, setData] = useState<InbodySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [segMode, setSegMode] = useState<"muscle" | "fat">("muscle");
  const [idx, setIdx] = useState(0);  // 選第幾筆（0 = 最新）

  useEffect(() => {
    fetchAPI<InbodySummary>("/inbody/me/summary?days=365")
      .then((d) => {
        setData(d);
        setIdx(0);  // 預設最新
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const current = data?.records?.[idx] ?? null;
  const prev = data?.records?.[idx + 1] ?? null;

  const metrics = useMemo<Metric[]>(() => {
    if (!current) return [];
    return [
      { zh: "體重",     en: "Weight",   v: current.weight,           prev: prev?.weight ?? null,           u: "kg",   decimals: 1, downIsGood: true  },
      { zh: "BMI",     en: "BMI",       v: current.bmi,              prev: prev?.bmi ?? null,              u: "",     decimals: 1, downIsGood: true  },
      { zh: "體脂率",   en: "Body Fat",  v: current.body_fat_pct,     prev: prev?.body_fat_pct ?? null,     u: "%",    decimals: 1, downIsGood: true  },
      { zh: "骨骼肌",   en: "Muscle",    v: current.muscle_mass,      prev: prev?.muscle_mass ?? null,      u: "kg",   decimals: 1, downIsGood: false },
      { zh: "內臟脂肪", en: "Visceral",  v: current.visceral_fat,     prev: prev?.visceral_fat ?? null,     u: "lvl",  decimals: 0, downIsGood: true  },
      { zh: "基礎代謝", en: "BMR",       v: current.metabolic_rate,   prev: prev?.metabolic_rate ?? null,   u: "kcal", decimals: 0, downIsGood: false },
      { zh: "身體年齡", en: "Body Age",  v: current.body_age,         prev: prev?.body_age ?? null,         u: "歲",   decimals: 0, downIsGood: true  },
      { zh: "體內水分", en: "Water",     v: current.total_body_water, prev: prev?.total_body_water ?? null, u: "kg",   decimals: 1, downIsGood: false },
      { zh: "蛋白質",   en: "Protein",   v: current.protein_mass,     prev: prev?.protein_mass ?? null,     u: "kg",   decimals: 1, downIsGood: false },
      { zh: "無機鹽",   en: "Mineral",   v: current.mineral_mass,     prev: prev?.mineral_mass ?? null,     u: "kg",   decimals: 1, downIsGood: false },
    ];
  }, [current, prev]);

  if (loading) return <div className="text-gray-500 py-8 text-center text-sm">載入中…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-3 rounded text-sm">錯誤：{err}</div>;
  if (!current) {
    return (
      <div className="flex flex-col gap-3.5">
        <Header />
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="text-sm text-gray-500">尚無 InBody 紀錄</div>
          <div className="text-xs text-gray-400 mt-1">診所測量後會自動同步至此</div>
        </div>
      </div>
    );
  }

  const hasSegmental = !!(current.muscle_segmental || current.fat_segmental);
  const records = data?.records ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <Header />

      {/* 日期選擇器 —— 紀錄超過 1 筆才顯示 */}
      {records.length > 1 && (
        <div className="flex items-center gap-2 bg-white rounded-xl p-2.5">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-gray-400 uppercase">Record</span>
            <span className="text-[11px] text-gray-500">測量紀錄</span>
          </div>
          <select
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            className="ml-auto border rounded px-2 py-1.5 text-sm font-mono"
          >
            {records.map((r, i) => (
              <option key={r.id} value={i}>
                {r.measured_at.slice(0, 10)}{i === 0 ? "（最新）" : ""}
              </option>
            ))}
          </select>
          <div className="flex">
            <button
              onClick={() => setIdx(Math.min(records.length - 1, idx + 1))}
              disabled={idx >= records.length - 1}
              className="text-xs px-2 py-1 border rounded-l hover:bg-gray-50 disabled:opacity-30"
              aria-label="prev"
            >
              ←
            </button>
            <button
              onClick={() => setIdx(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="text-xs px-2 py-1 border-t border-b border-r rounded-r hover:bg-gray-50 disabled:opacity-30"
              aria-label="next"
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* 日期 header */}
      <div className="text-[11px] text-gray-500 font-mono">
        {idx === 0 ? "LATEST · " : ""}
        {current.measured_at.slice(0, 10).replace(/-/g, ".")}
        {prev && (
          <span className="ml-2 text-gray-400">
            vs {prev.measured_at.slice(0, 10).replace(/-/g, ".")}
          </span>
        )}
      </div>

      {/* Segmental body map */}
      <div className="bg-white rounded-2xl p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="text-sm font-semibold">分部位分析</div>
            <div className="text-[10px] text-gray-400 font-mono">SEGMENTAL · {segMode === "muscle" ? "MUSCLE" : "FAT"}</div>
          </div>
          {hasSegmental && (
            <div className="flex text-[11px] rounded-full bg-[#edf4f2] p-0.5">
              <button
                onClick={() => setSegMode("muscle")}
                className={`px-3 py-0.5 rounded-full transition-colors ${
                  segMode === "muscle" ? "bg-teal-600 text-white" : "text-gray-500"
                }`}
              >
                肌肉
              </button>
              <button
                onClick={() => setSegMode("fat")}
                className={`px-3 py-0.5 rounded-full transition-colors ${
                  segMode === "fat" ? "bg-teal-600 text-white" : "text-gray-500"
                }`}
              >
                脂肪
              </button>
            </div>
          )}
        </div>
        <BodyMap seg={segMode === "muscle" ? current.muscle_segmental : current.fat_segmental} />
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {metrics.map((m) => <MetricCard key={m.en} m={m} />)}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <div className="text-[22px] font-bold tracking-tight">InBody 身體組成</div>
    </div>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const d = m.v !== null && m.prev !== null ? m.v - m.prev : null;
  const good = d !== null ? (m.downIsGood ? d < 0 : d > 0) : false;
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
