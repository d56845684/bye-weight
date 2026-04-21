"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";
import { Ring } from "@/components/charts";

// Direction B Diet tab：今日熱量 ring + 三大營養素 bar + 餐點卡片。
// 資料來源：/food-logs/me/summary（Phase 2）。

type FoodItem = {
  id: number;
  logged_at: string;
  meal_type: string | null;
  image_url: string | null;
  food_items: { name: string; portion?: string }[] | null;
  total_calories: number | null;
  total_protein: number | null;
  total_carbs: number | null;
  total_fat: number | null;
  ai_suggestion: string | null;
};

type FoodSummary = {
  target_kcal: number | null;
  today_kcal: number;
  today_meals: FoodItem[];
  macros_avg: { carbs: number; protein: number; fat: number } | null;
};

const DEFAULT_TARGET_KCAL = 1650;
const MEAL_META: Record<string, { zh: string; en: string; img: string }> = {
  breakfast: { zh: "早餐", en: "Breakfast", img: "#fef0e4" },
  lunch:     { zh: "午餐", en: "Lunch",     img: "#e8f1e4" },
  dinner:    { zh: "晚餐", en: "Dinner",    img: "#e4ecf4" },
  snack:     { zh: "點心", en: "Snack",     img: "#f0e8f4" },
};

export default function PatientFoodLogsPage() {
  const [data, setData] = useState<FoodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<FoodSummary>("/food-logs/me/summary?days=30")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 py-8 text-center text-sm">載入中…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-3 rounded text-sm">錯誤：{err}</div>;

  const target = data?.target_kcal ?? DEFAULT_TARGET_KCAL;
  const todayKcal = data?.today_kcal ?? 0;
  const meals = data?.today_meals ?? [];
  const macros = data?.macros_avg;
  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  }).toUpperCase();

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[22px] font-bold tracking-tight">飲食記錄</div>
          <div className="text-[11px] text-gray-500 font-mono">{dateStr} · {meals.length} MEALS</div>
        </div>
      </div>

      {/* Ring + macros */}
      <div className="bg-white rounded-2xl p-4 flex gap-3.5 items-center">
        <Ring value={todayKcal} max={target} size={90} stroke={9} color="#0d9488" trackColor="#edf4f2">
          <div className="text-center">
            <div className="text-lg font-bold font-mono">{Math.round(todayKcal)}</div>
            <div className="text-[9px] text-gray-400 font-mono">/ {target}</div>
          </div>
        </Ring>
        <div className="flex-1">
          {macros ? (
            [
              { l: "Carbs 碳水",   v: macros.carbs,   c: "#0d9488" },
              { l: "Protein 蛋白", v: macros.protein, c: "#f59e0b" },
              { l: "Fat 脂肪",     v: macros.fat,     c: "#a78bfa" },
            ].map((m) => (
              <div key={m.l} className="mb-1.5">
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-gray-500">{m.l}</span>
                  <span className="font-mono font-semibold">{m.v}%</span>
                </div>
                <div className="h-1 bg-gray-100 rounded">
                  <div className="h-full rounded" style={{ width: `${m.v}%`, background: m.c }} />
                </div>
              </div>
            ))
          ) : (
            <div className="text-xs text-gray-400 leading-relaxed">
              尚無足夠紀錄顯示營養素分佈
              <br />至少需一餐有完整 C/P/F 數值
            </div>
          )}
        </div>
      </div>

      {meals.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="text-sm text-gray-500">今天尚無飲食紀錄</div>
          <div className="text-xs text-gray-400 mt-1">可在 LINE OA 傳照片，營養師會協助記錄</div>
        </div>
      ) : (
        meals.map((m) => <MealCard key={m.id} m={m} />)
      )}
    </div>
  );
}

function MealCard({ m }: { m: FoodItem }) {
  const meta = MEAL_META[m.meal_type ?? ""] ?? { zh: m.meal_type ?? "餐點", en: "", img: "#f5f5f5" };
  const time = new Date(m.logged_at).toLocaleTimeString("zh-TW", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const items = m.food_items?.map((i) => i.name).join("、") ?? "";

  return (
    <div className="bg-white rounded-2xl overflow-hidden">
      <div className="h-[110px] flex items-end p-2.5 relative" style={{ background: meta.img }}>
        {m.image_url && <img src={m.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        <div className="absolute top-2.5 right-2.5 text-[10px] font-mono bg-white/80 text-gray-700 px-2 py-0.5 rounded-xl">
          {time}
        </div>
      </div>
      <div className="p-3.5">
        <div className="flex items-baseline justify-between">
          <div className="text-[15px] font-bold">
            {meta.zh}
            {meta.en && <span className="text-[11px] text-gray-400 font-normal ml-1">{meta.en}</span>}
          </div>
          <div className="text-[15px] font-bold font-mono">
            {m.total_calories ? Math.round(m.total_calories) : "—"}
            <span className="text-[10px] text-gray-400 font-normal ml-0.5">kcal</span>
          </div>
        </div>
        {items && <div className="text-xs text-gray-500 mt-1.5 leading-relaxed">{items}</div>}
        <div className="flex gap-1.5 mt-2.5">
          {([["C", m.total_carbs], ["P", m.total_protein], ["F", m.total_fat]] as const).map(([l, v]) => (
            <div key={l} className="text-[10px] px-2 py-0.5 bg-[#edf4f2] rounded-xl font-mono">
              <b>{l}</b> {v !== null ? `${v}g` : "—"}
            </div>
          ))}
        </div>
        {m.ai_suggestion && (
          <div className="mt-2.5 p-2.5 rounded-xl text-[11.5px] leading-relaxed border-l-[3px] border-teal-600"
               style={{ background: "rgba(13,148,136,0.1)" }}>
            <span className="font-mono text-teal-600 font-bold text-[10px] mr-1.5">AI</span>
            {m.ai_suggestion}
          </div>
        )}
      </div>
    </div>
  );
}
