"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

// Admin tenant-wide 看診紀錄。upcoming 排前面。

type Row = {
  id: number;
  patient_id: number;
  patient_name: string | null;
  chart_no: string | null;
  visit_date: string;
  next_visit_date: string | null;
  doctor_id: string | null;
  notes: string | null;
  upcoming: boolean;
  days_away: number | null;
};

export default function AdminVisitsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [upcomingOnly, setUpcomingOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (upcomingOnly) qs.set("upcoming_only", "true");
      const data = await fetchAPI<Row[]>(`/visits/records?${qs}`);
      setRows(data);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [upcomingOnly]);

  useEffect(() => { load(); }, [load]);

  const upcomingCount = rows.filter((r) => r.upcoming).length;

  return (
    <div>
      <div className="flex items-center mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold">看診紀錄</h1>
        <span className="text-xs text-gray-500">全 tenant · {upcomingCount} 筆 upcoming</span>
        <label className="ml-auto text-xs flex items-center gap-1">
          <input type="checkbox" checked={upcomingOnly} onChange={(e) => setUpcomingOnly(e.target.checked)} />
          只看 upcoming
        </label>
        <button onClick={load} className="text-sm px-3 py-1 border rounded hover:bg-gray-100">
          重新整理
        </button>
      </div>

      {err && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{err}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-400">無紀錄</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">日期</th>
                <th className="p-3">病患</th>
                <th className="p-3">醫師</th>
                <th className="p-3">備註</th>
                <th className="p-3">下次回診</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}
                    className={`border-t align-top ${r.upcoming ? "bg-teal-50" : ""}`}>
                  <td className="p-3 whitespace-nowrap font-mono">{r.visit_date}</td>
                  <td className="p-3">
                    <Link href={`/admin/patients/${r.patient_id}`}
                          className="text-red-700 hover:underline">
                      {r.patient_name ?? `#${r.patient_id}`}
                    </Link>
                    {r.chart_no && <span className="ml-1.5 text-[10px] font-mono text-gray-400">{r.chart_no}</span>}
                  </td>
                  <td className="p-3">{r.doctor_id ?? "—"}</td>
                  <td className="p-3 text-xs text-gray-700 max-w-md leading-relaxed">{r.notes ?? "—"}</td>
                  <td className="p-3 whitespace-nowrap font-mono">
                    {r.next_visit_date ?? "—"}
                    {r.upcoming && (
                      <span className="ml-1.5 text-[10px] bg-teal-600 text-white px-1.5 py-0.5 rounded">
                        剩 {r.days_away} 天
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
