"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

// Admin tenant-wide 飲食紀錄。按日期時序倒排，每列顯示病患姓名 + 病歷號連到 detail 頁。

type Row = {
  id: number;
  patient_id: number;
  patient_name: string | null;
  chart_no: string | null;
  logged_at: string;
  meal_type: string | null;
  total_calories: number | null;
  total_protein: number | null;
  total_carbs: number | null;
  total_fat: number | null;
  ai_suggestion: string | null;
};

const MEAL_LABEL: Record<string, string> = {
  breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "點心",
};

const PAGE_SIZE = 100;

export default function AdminFoodLogsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        days: String(days), limit: String(PAGE_SIZE), offset: String(offset),
      });
      const data = await fetchAPI<Row[]>(`/food-logs/records?${qs}`);
      setRows(data);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [days, offset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold">飲食紀錄</h1>
        <span className="text-xs text-gray-500">全 tenant 範圍，最近 {days} 天</span>
        <div className="ml-auto flex gap-2">
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setOffset(0); }}
                  className="text-sm border rounded px-2 py-1">
            <option value={1}>1 天</option>
            <option value={7}>7 天</option>
            <option value={30}>30 天</option>
            <option value={90}>90 天</option>
          </select>
          <button onClick={load} className="text-sm px-3 py-1 border rounded hover:bg-gray-100">
            重新整理
          </button>
        </div>
      </div>

      {err && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{err}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-400">
          此區間無飲食紀錄
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="p-3">時間</th>
                  <th className="p-3">病患</th>
                  <th className="p-3">餐</th>
                  <th className="p-3 text-right">kcal</th>
                  <th className="p-3 text-right">C / P / F g</th>
                  <th className="p-3">AI 建議</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 whitespace-nowrap font-mono text-xs">
                      {new Date(r.logged_at).toLocaleString("zh-TW", {
                        month: "2-digit", day: "2-digit",
                        hour: "2-digit", minute: "2-digit", hour12: false,
                      })}
                    </td>
                    <td className="p-3">
                      <Link href={`/admin/patients/${r.patient_id}`}
                            className="text-red-700 hover:underline">
                        {r.patient_name ?? `#${r.patient_id}`}
                      </Link>
                      {r.chart_no && <span className="ml-1.5 text-[10px] font-mono text-gray-400">{r.chart_no}</span>}
                    </td>
                    <td className="p-3">{MEAL_LABEL[r.meal_type ?? ""] ?? r.meal_type ?? "—"}</td>
                    <td className="p-3 text-right font-mono">
                      {r.total_calories ? Math.round(r.total_calories) : "—"}
                    </td>
                    <td className="p-3 text-right font-mono text-xs text-gray-500">
                      {fmt(r.total_carbs)} / {fmt(r.total_protein)} / {fmt(r.total_fat)}
                    </td>
                    <td className="p-3 text-xs text-gray-500 max-w-xs truncate">
                      {r.ai_suggestion ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm">
            <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    disabled={offset === 0}
                    className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">
              ← 上一頁
            </button>
            <span className="text-gray-500 text-xs">
              顯示 {offset + 1} – {offset + rows.length}
            </span>
            <button onClick={() => setOffset(offset + PAGE_SIZE)}
                    disabled={rows.length < PAGE_SIZE}
                    className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">
              下一頁 →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function fmt(v: number | null): string {
  return v === null || v === undefined ? "—" : Math.round(v).toString();
}
