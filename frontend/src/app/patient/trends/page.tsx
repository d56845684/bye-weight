"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";
import { BarChart, LineChart, StackedBarChart } from "@/components/charts";

// Direction B Trends tab：3 張圖
//   - 體重/體脂 雙線（inbody summary.series）
//   - 每日熱量 bar + target 虛線
//   - 三大營養素 stacked bar
// 同時抓 inbody summary + food summary。

type InbodySummary = {
  series: {
    dates: string[];
    weight: (number | null)[];
    body_fat_pct: (number | null)[];
    muscle_mass: (number | null)[];
  };
};

type FoodSummary = {
  target_kcal: number | null;
  dates: string[];
  kcal_series: (number | null)[];
  macros_series: ({ carbs: number; protein: number; fat: number } | null)[];
};

const DEFAULT_TARGET_KCAL = 1650;

export default function PatientTrendsPage() {
  const [inbody, setInbody] = useState<InbodySummary | null>(null);
  const [food, setFood] = useState<FoodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [i, f] = await Promise.allSettled([
          fetchAPI<InbodySummary>("/inbody/me/summary?days=30"),
          fetchAPI<FoodSummary>("/food-logs/me/summary?days=30"),
        ]);
        if (i.status === "fulfilled") setInbody(i.value);
        if (f.status === "fulfilled") setFood(f.value);
        if (i.status === "rejected" && f.status === "rejected") {
          setErr("無法載入資料");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-gray-500 py-8 text-center text-sm">載入中…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-3 rounded text-sm">錯誤：{err}</div>;

  const weightSeries = inbody?.series.weight ?? [];
  const fatSeries = inbody?.series.body_fat_pct ?? [];
  const hasInbody = weightSeries.some((v) => v !== null);

  const kcalSeries = food?.kcal_series ?? [];
  const hasFood = kcalSeries.some((v) => v !== null);
  const target = food?.target_kcal ?? DEFAULT_TARGET_KCAL;

  const macrosSeries = (food?.macros_series ?? []);

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <div className="text-[22px] font-bold tracking-tight">趨勢圖表</div>
        <div className="text-[11px] text-gray-500 font-mono">
          LAST 30 DAYS
        </div>
      </div>

      <Card title="體重 / 體脂" subtitle="Weight & Body Fat">
        {hasInbody ? (
          <LineChart
            data={weightSeries}
            data2={fatSeries}
            dates={inbody?.series.dates}
            width={320} height={180}
            color="#0d9488" color2="#f59e0b"
          />
        ) : (
          <EmptyHint />
        )}
      </Card>

      <Card title="每日熱量" subtitle="Daily Calories">
        {hasFood ? (
          <BarChart
            data={kcalSeries}
            dates={food?.dates}
            target={target}
            width={320} height={160}
            color="#0d9488"
          />
        ) : (
          <EmptyHint />
        )}
      </Card>

      <Card title="三大營養素" subtitle="Macros %">
        {hasFood && macrosSeries.some((m) => m !== null) ? (
          <StackedBarChart
            data={macrosSeries}
            dates={food?.dates}
            width={320} height={160}
            colors={["#0d9488", "#f59e0b", "#a78bfa"]}
          />
        ) : (
          <EmptyHint />
        )}
      </Card>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-3.5">
      <div className="text-[13px] font-bold">{title}</div>
      <div className="text-[10px] text-gray-400 font-mono mb-1.5">{subtitle}</div>
      {children}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="text-center text-xs text-gray-400 py-10">
      尚無 30 天內的資料
    </div>
  );
}
