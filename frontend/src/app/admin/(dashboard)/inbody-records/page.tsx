"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchAPI } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";

type RecordItem = {
  id: number;
  patient_id: number;
  patient_name: string | null;
  chart_no: string | null;
  tenant_id: number;
  measured_at: string;
  weight: number | null;
  bmi: number | null;
  body_fat_pct: number | null;
  muscle_mass: number | null;
  visceral_fat: number | null;
  metabolic_rate: number | null;
  match_status: string | null;
  uploaded_by: number | null;
};

type SearchHit = {
  id: number;
  name: string;
  chart_no: string | null;
};

const PAGE_SIZE = 50;

export default function InbodyRecordsPage() {
  const { role } = usePermissions();
  const isSuper = role === "super_admin";

  const [rows, setRows] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [allTenants, setAllTenants] = useState(false);
  const [patientFilter, setPatientFilter] = useState<SearchHit | null>(null);
  const [offset, setOffset] = useState(0);

  // 病患搜尋框
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String(offset));
      if (patientFilter) qs.set("patient_id", String(patientFilter.id));
      if (isSuper && allTenants) qs.set("all_tenants", "true");
      const data = await fetchAPI<RecordItem[]>(`/inbody/records?${qs.toString()}`);
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [offset, patientFilter, allTenants, isSuper]);

  useEffect(() => {
    load();
  }, [load]);

  const runSearch = async () => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const data = await fetchAPI<{ patients: SearchHit[] }>(
        `/patients?q=${encodeURIComponent(query.trim())}`,
      );
      setHits(data.patients ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        alert("沒有搜尋病患的權限");
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <div className="flex items-center mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold">InBody 紀錄</h1>
        {patientFilter && (
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
            僅顯示 {patientFilter.name}
            <button
              onClick={() => {
                setPatientFilter(null);
                setOffset(0);
              }}
              className="ml-2 text-yellow-900 hover:underline"
            >
              清除
            </button>
          </span>
        )}
        {isSuper && (
          <label className="text-xs flex items-center gap-1 ml-auto">
            <input
              type="checkbox"
              checked={allTenants}
              onChange={(e) => {
                setAllTenants(e.target.checked);
                setOffset(0);
              }}
            />
            跨租戶顯示（super_admin only）
          </label>
        )}
        <button
          onClick={load}
          className="text-sm px-3 py-1 border rounded hover:bg-gray-100"
        >
          重新整理
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-3 mb-3">
        <div className="text-xs text-gray-500 mb-1">依病患篩選</div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="輸入姓名…"
            className="flex-1 border rounded px-3 py-1 text-sm"
          />
          <button
            onClick={runSearch}
            disabled={searching}
            className="text-sm px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50"
          >
            {searching ? "搜尋中…" : "搜尋"}
          </button>
        </div>
        {hits.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {hits.map((h) => (
              <li key={h.id} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{h.name}</span>
                  {h.chart_no && <span className="ml-2 text-xs font-mono text-gray-500">{h.chart_no}</span>}
                </span>
                <button
                  onClick={() => {
                    setPatientFilter(h);
                    setHits([]);
                    setQuery("");
                    setOffset(0);
                  }}
                  className="text-xs border border-red-700 text-red-700 rounded px-3 py-1 hover:bg-red-50"
                >
                  套用
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-400">
          {patientFilter ? "此病患尚無 InBody 紀錄" : "目前沒有 InBody 紀錄"}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="p-3">測量時間</th>
                  <th className="p-3">病患</th>
                  <th className="p-3">病歷號</th>
                  {isSuper && allTenants && <th className="p-3">Tenant</th>}
                  <th className="p-3 text-right">體重</th>
                  <th className="p-3 text-right">BMI</th>
                  <th className="p-3 text-right">體脂</th>
                  <th className="p-3 text-right">肌肉</th>
                  <th className="p-3 text-right">內臟</th>
                  <th className="p-3 text-right">基代</th>
                  <th className="p-3">來源</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 whitespace-nowrap">
                      {new Date(r.measured_at).toLocaleString("zh-TW")}
                    </td>
                    <td className="p-3 font-medium">{r.patient_name ?? `#${r.patient_id}`}</td>
                    <td className="p-3 font-mono text-xs">{r.chart_no ?? "—"}</td>
                    {isSuper && allTenants && <td className="p-3 text-xs">{r.tenant_id}</td>}
                    <td className="p-3 text-right">{fmt(r.weight, "kg")}</td>
                    <td className="p-3 text-right">{fmt(r.bmi)}</td>
                    <td className="p-3 text-right">{fmt(r.body_fat_pct, "%")}</td>
                    <td className="p-3 text-right">{fmt(r.muscle_mass, "kg")}</td>
                    <td className="p-3 text-right">{r.visceral_fat ?? "—"}</td>
                    <td className="p-3 text-right">{fmt(r.metabolic_rate)}</td>
                    <td className="p-3">
                      <MatchBadge status={r.match_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100"
            >
              ← 上一頁
            </button>
            <span className="text-gray-500 text-xs">
              顯示 {offset + 1} – {offset + rows.length}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={rows.length < PAGE_SIZE}
              className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100"
            >
              下一頁 →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function fmt(v: number | null, unit?: string) {
  if (v === null || v === undefined) return "—";
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return unit ? `${s} ${unit}` : s;
}

function MatchBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">—</span>;
  const map: Record<string, string> = {
    matched: "bg-green-100 text-green-700",     // 自動配對
    manual: "bg-blue-100 text-blue-700",         // 人工指派 (pending resolve)
  };
  const label: Record<string, string> = {
    matched: "自動",
    manual: "人工",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {label[status] ?? status}
    </span>
  );
}
