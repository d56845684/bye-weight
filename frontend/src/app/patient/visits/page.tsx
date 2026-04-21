"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

// Direction B Visits tab：日期 chip + 科別/醫師 + 備註，upcoming 綠框。
// 資料來源：/visits/me/timeline（Phase 2 後端已排序 + 算 days_away）。

type VisitItem = {
  id: number;
  visit_date: string;           // YYYY-MM-DD
  next_visit_date: string | null;
  doctor_id: string | null;
  notes: string | null;
  upcoming: boolean;
  days_away: number | null;
  created_at: string;
};

const MONTHS_EN = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

export default function PatientVisitsPage() {
  const [visits, setVisits] = useState<VisitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<VisitItem[]>("/visits/me/timeline")
      .then(setVisits)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 py-8 text-center text-sm">載入中…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-3 rounded text-sm">錯誤：{err}</div>;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-[22px] font-bold tracking-tight">看診紀錄</div>
      {visits.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="text-sm text-gray-500">尚無看診紀錄</div>
        </div>
      ) : (
        visits.map((v) => <VisitCard key={v.id} v={v} />)
      )}
    </div>
  );
}

function VisitCard({ v }: { v: VisitItem }) {
  // upcoming 的話 chip 用 next_visit_date，否則用 visit_date
  const displayDate = v.upcoming && v.next_visit_date ? v.next_visit_date : v.visit_date;
  const [y, m, d] = displayDate.split("-");
  const monthLabel = MONTHS_EN[Number(m) - 1] ?? m;

  return (
    <div
      className={`rounded-2xl p-4 ${v.upcoming ? "border border-teal-500/35" : "bg-white"}`}
      style={v.upcoming ? { background: "rgba(13,148,136,0.08)" } : undefined}
    >
      <div className="flex gap-3">
        <div
          className={`rounded-xl px-3 py-2 text-center min-w-[54px] h-fit ${
            v.upcoming ? "bg-teal-600 text-white" : "bg-[#edf4f2] text-gray-800"
          }`}
        >
          <div className="text-[9px] tracking-widest opacity-80">{monthLabel}</div>
          <div className="text-xl font-bold leading-none">{d}</div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold">{v.upcoming ? "下次回診" : "看診紀錄"}</span>
            {v.upcoming && (
              <span className="text-[9px] bg-teal-600 text-white px-1.5 py-px rounded font-mono font-bold">
                UPCOMING
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 font-mono">
            {y.slice(2)}/{m}/{d}
            {v.doctor_id && <> · {v.doctor_id}</>}
            {v.upcoming && v.days_away !== null && <> · 剩 {v.days_away} 天</>}
          </div>
          {v.notes && <div className="text-xs text-gray-500 mt-2 leading-relaxed">{v.notes}</div>}
        </div>
      </div>
    </div>
  );
}
