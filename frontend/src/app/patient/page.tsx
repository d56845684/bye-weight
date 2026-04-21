"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchAPI } from "@/lib/api";
import { LineChart, Ring } from "@/components/charts";

// Direction B Home：greeting + 體重 hero + 3 quick stats + 今日熱量 + upcoming visit。
// 一次 fetch 3 支 summary endpoints（Phase 2 後端已聚合），各自失敗不相互阻擋。

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
  series: { dates: string[]; weight: (number | null)[]; body_fat_pct: (number | null)[]; muscle_mass: (number | null)[] };
};

type FoodSummary = {
  target_kcal: number | null;
  today_kcal: number;
  today_meals: { id: number; logged_at: string; meal_type: string | null; total_calories: number | null }[];
  dates: string[];
  kcal_series: (number | null)[];
  macros_series: ({ carbs: number; protein: number; fat: number } | null)[];
  macros_avg: { carbs: number; protein: number; fat: number } | null;
};

type VisitItem = {
  id: number; visit_date: string; next_visit_date: string | null;
  doctor_id: string | null; notes: string | null;
  upcoming: boolean; days_away: number | null;
};

type Me = { name: string; chart_no: string | null };

const DEFAULT_TARGET_KCAL = 1650;  // Phase 3 才加 per-patient target；目前 placeholder
const MEAL_LABEL: Record<string, string> = {
  breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "點心",
};

export default function PatientHome() {
  const [me, setMe] = useState<Me | null>(null);
  const [inbody, setInbody] = useState<InbodySummary | null>(null);
  const [food, setFood] = useState<FoodSummary | null>(null);
  const [visits, setVisits] = useState<VisitItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [m, i, f, v] = await Promise.allSettled([
          fetchAPI<Me>("/patients/me"),
          fetchAPI<InbodySummary>("/inbody/me/summary?days=30"),
          fetchAPI<FoodSummary>("/food-logs/me/summary?days=30"),
          fetchAPI<VisitItem[]>("/visits/me/timeline"),
        ]);
        if (m.status === "fulfilled") setMe(m.value);
        if (i.status === "fulfilled") setInbody(i.value);
        if (f.status === "fulfilled") setFood(f.value);
        if (v.status === "fulfilled") setVisits(v.value);
        // 最嚴重的錯誤（/me 掛了代表沒 profile → 導去 register 由 LIFF 處理；這裡只 show msg）
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
  const upcoming = visits.find((v) => v.upcoming);
  const target = food?.target_kcal ?? DEFAULT_TARGET_KCAL;

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

      {/* Today calories + meal list */}
      <TodayCalories food={food} target={target} loading={loading} />

      {/* Upcoming visit */}
      {upcoming && <UpcomingVisit v={upcoming} />}
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

function TodayCalories({ food, target, loading }: { food: FoodSummary | null; target: number; loading: boolean }) {
  const today = food?.today_kcal ?? 0;
  const pct = target > 0 ? Math.round((today / target) * 100) : 0;
  const meals = food?.today_meals ?? [];
  return (
    <div className="bg-white rounded-2xl p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold">今日熱量</div>
          <div className="text-[11px] text-gray-500 font-mono">TODAY&apos;S CALORIES</div>
        </div>
        {!loading && <div className="text-[11px] text-teal-600 font-mono font-semibold">{pct}%</div>}
      </div>
      <div className="flex items-center gap-3.5 mt-3">
        <Ring value={today} max={target} size={72} stroke={8} color="#0d9488" trackColor="#edf4f2">
          <div className="text-center">
            <div className="text-[15px] font-bold font-mono">{Math.round(today)}</div>
            <div className="text-[8px] text-gray-400 font-mono">/ {target}</div>
          </div>
        </Ring>
        <div className="flex-1 flex flex-col gap-1.5">
          {meals.length === 0 ? (
            <div className="text-xs text-gray-400">{loading ? "載入中…" : "今天尚無飲食紀錄"}</div>
          ) : meals.map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-[11px]">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-600" />
              <span className="text-gray-500 font-mono w-9">
                {new Date(m.logged_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
              <span className="flex-1">{MEAL_LABEL[m.meal_type ?? ""] ?? m.meal_type ?? "餐點"}</span>
              <span className="font-mono font-semibold">{m.total_calories ? Math.round(m.total_calories) : "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UpcomingVisit({ v }: { v: VisitItem }) {
  const d = v.next_visit_date ? new Date(v.next_visit_date) : null;
  const month = d ? d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() : "";
  const day = d ? d.getDate() : "";
  return (
    <div className="rounded-2xl p-4 border border-teal-500/30" style={{ background: "rgba(13,148,136,0.08)" }}>
      <div className="flex gap-3 items-start">
        <div className="bg-teal-600 text-white rounded-xl px-3 py-2 text-center min-w-[54px]">
          <div className="text-[9px] tracking-widest">{month}</div>
          <div className="text-xl font-bold leading-none mt-0.5">{day}</div>
        </div>
        <div className="flex-1">
          <div className="text-[10px] text-teal-600 font-mono font-bold">
            UPCOMING · IN {v.days_away} DAYS
          </div>
          <div className="text-sm font-bold mt-0.5">下次回診</div>
          {v.doctor_id && <div className="text-xs text-gray-500">{v.doctor_id}</div>}
          {v.notes && <div className="text-[11px] text-gray-500 mt-1.5 leading-relaxed line-clamp-3">{v.notes}</div>}
        </div>
      </div>
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
