"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

// Admin tenant-wide 目標變更時序。每列 = 一次 snapshot；同病患的歷史靠日期 + row 區分。

type Row = {
  id: number;
  patient_id: number;
  patient_name: string | null;
  chart_no: string | null;
  effective_from: string;
  daily_kcal: number | null;
  target_weight: number | null;
  target_body_fat: number | null;
  target_carbs_pct: number | null;
  target_protein_pct: number | null;
  target_fat_pct: number | null;
  set_by: number | null;
  notes: string | null;
  created_at: string;
};

export default function AdminPatientGoalsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI<Row[]>("/patient-goals");
      setRows(data);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 依 patient 分群，每個病患 show 最新一筆置頂 + 歷史摺疊
  const byPatient: Record<number, Row[]> = {};
  for (const r of rows) (byPatient[r.patient_id] ||= []).push(r);
  // 每群內部應該已經按時序排好（backend ORDER BY effective_from DESC）

  return (
    <div>
      <div className="flex items-center mb-4 gap-3">
        <h1 className="text-xl font-bold">目標歷史</h1>
        <span className="text-xs text-gray-500">
          全 tenant · {Object.keys(byPatient).length} 位病患 · {rows.length} 筆 snapshot
        </span>
        <button onClick={load} className="ml-auto text-sm px-3 py-1 border rounded hover:bg-gray-100">
          重新整理
        </button>
      </div>

      {err && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{err}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-400">
          尚未設定任何目標
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">生效日</th>
                <th className="p-3">病患</th>
                <th className="p-3 text-right">每日熱量</th>
                <th className="p-3 text-right">體重目標</th>
                <th className="p-3 text-right">體脂目標</th>
                <th className="p-3 text-right">C / P / F %</th>
                <th className="p-3">備註</th>
                <th className="p-3">設定者</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isLatest = byPatient[r.patient_id][0].id === r.id;
                return (
                  <tr key={r.id}
                      className={`border-t align-top ${isLatest ? "bg-teal-50" : ""}`}>
                    <td className="p-3 whitespace-nowrap font-mono">
                      {r.effective_from}
                      {isLatest && <span className="ml-1.5 text-[10px] bg-teal-600 text-white px-1.5 py-0.5 rounded">當前</span>}
                    </td>
                    <td className="p-3">
                      <Link href={`/admin/patients/${r.patient_id}`}
                            className="text-red-700 hover:underline">
                        {r.patient_name ?? `#${r.patient_id}`}
                      </Link>
                      {r.chart_no && <span className="ml-1.5 text-[10px] font-mono text-gray-400">{r.chart_no}</span>}
                    </td>
                    <td className="p-3 text-right font-mono">{r.daily_kcal ?? "—"}</td>
                    <td className="p-3 text-right font-mono">{fmt(r.target_weight)}</td>
                    <td className="p-3 text-right font-mono">{fmt(r.target_body_fat)}</td>
                    <td className="p-3 text-right font-mono text-xs">
                      {fmt(r.target_carbs_pct, 0)} / {fmt(r.target_protein_pct, 0)} / {fmt(r.target_fat_pct, 0)}
                    </td>
                    <td className="p-3 text-xs text-gray-700 max-w-xs">{r.notes ?? "—"}</td>
                    <td className="p-3 text-xs text-gray-500">{r.set_by ? `#${r.set_by}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) && decimals === 0 ? String(v) : v.toFixed(decimals);
}
