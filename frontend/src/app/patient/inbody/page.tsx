"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";
import { BodyMap } from "@/components/BodyMap";

// Direction B Body tab：InBody 最新紀錄 + 8 格 metric grid + 分部位示意圖。
// 資料來源：/inbody/me/summary（Phase 2/3 後端已算好 prev + deltas + segmental）。

type Segmental = {
  la: number | null; ra: number | null; tr: number | null;
  ll: number | null; rl: number | null;
};

type InbodySummary = {
  latest: {
    measured_at: string;
    weight: number | null; weight_prev: number | null;
    bmi: number | null; bmi_prev: number | null;
    body_fat_pct: number | null; body_fat_pct_prev: number | null;
    muscle_mass: number | null; muscle_mass_prev: number | null;
    visceral_fat: number | null; visceral_fat_prev: number | null;
    metabolic_rate: number | null; metabolic_rate_prev: number | null;
    body_age: number | null; body_age_prev: number | null;
    total_body_water: number | null;
    protein_mass: number | null;
    mineral_mass: number | null;
    muscle_segmental: Segmental | null;
    fat_segmental: Segmental | null;
  } | null;
};

type Metric = {
  zh: string;
  en: string;
  v: number | null;
  prev: number | null;
  u: string;
  decimals: number;
  downIsGood: boolean;   // 下降為好 → teal 上升 → orange
};

export default function PatientInbodyPage() {
  const [data, setData] = useState<InbodySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [segMode, setSegMode] = useState<"muscle" | "fat">("muscle");

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
    { zh: "體重",     en: "Weight",   v: l.weight,            prev: l.weight_prev,         u: "kg",   decimals: 1, downIsGood: true  },
    { zh: "BMI",     en: "BMI",       v: l.bmi,               prev: l.bmi_prev,            u: "",     decimals: 1, downIsGood: true  },
    { zh: "體脂率",   en: "Body Fat",  v: l.body_fat_pct,      prev: l.body_fat_pct_prev,   u: "%",    decimals: 1, downIsGood: true  },
    { zh: "骨骼肌",   en: "Muscle",    v: l.muscle_mass,       prev: l.muscle_mass_prev,    u: "kg",   decimals: 1, downIsGood: false },
    { zh: "內臟脂肪", en: "Visceral",  v: l.visceral_fat,      prev: l.visceral_fat_prev,   u: "lvl",  decimals: 0, downIsGood: true  },
    { zh: "基礎代謝", en: "BMR",       v: l.metabolic_rate,    prev: l.metabolic_rate_prev, u: "kcal", decimals: 0, downIsGood: false },
    { zh: "身體年齡", en: "Body Age",  v: l.body_age,          prev: l.body_age_prev,       u: "歲",   decimals: 0, downIsGood: true  },
    { zh: "體內水分", en: "Water",     v: l.total_body_water,  prev: null,                  u: "kg",   decimals: 1, downIsGood: false },
    { zh: "蛋白質",   en: "Protein",   v: l.protein_mass,      prev: null,                  u: "kg",   decimals: 1, downIsGood: false },
    { zh: "無機鹽",   en: "Mineral",   v: l.mineral_mass,      prev: null,                  u: "kg",   decimals: 1, downIsGood: false },
  ];

  const hasSegmental = !!(l.muscle_segmental || l.fat_segmental);

  return (
    <div className="flex flex-col gap-3.5">
      <Header date={l.measured_at} />

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
        <BodyMap seg={segMode === "muscle" ? l.muscle_segmental : l.fat_segmental} />
      </div>

      {/* Metric grid (展開到 10 格，適應 2-col) */}
      <div className="grid grid-cols-2 gap-2.5">
        {metrics.map((m) => <MetricCard key={m.en} m={m} />)}
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
