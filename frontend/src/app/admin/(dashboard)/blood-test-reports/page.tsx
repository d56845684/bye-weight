"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ApiError, fetchAPI } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";

type LabValue = { value: number | null; flag: "H" | "L" | null };

type ReportItem = {
  id: number;
  patient_id: number;
  patient_name: string | null;
  chart_no: string | null;
  tenant_id: number;
  hl_report_id: string;
  hl_mrno: string | null;
  detect_no: string | null;
  clinic_name: string | null;
  test_date: string;
  lab_values: Record<string, LabValue> | null;
};

type SearchHit = {
  id: number;
  name: string;
  chart_no: string | null;
};

const PAGE_SIZE = 50;

// 檢驗欄位代碼 → {中文名, 單位}，並依生理分組（顯示順序 = 此處順序）。
// 代碼對齊 main_service services/healthleader_parse.LAB_MAP 的輸出。
const LAB_GROUPS: { title: string; items: { key: string; label: string; unit?: string }[] }[] = [
  {
    title: "血球 (CBC)",
    items: [
      { key: "WBC", label: "白血球", unit: "10³/µL" },
      { key: "Neutrophil", label: "中性球", unit: "%" },
      { key: "Lymphocyte", label: "淋巴球", unit: "%" },
      { key: "Monocyte", label: "單核球", unit: "%" },
      { key: "Eosinophil", label: "嗜酸性球", unit: "%" },
      { key: "Basophil", label: "嗜鹼性球", unit: "%" },
      { key: "RBC", label: "紅血球", unit: "10⁶/µL" },
      { key: "Hb", label: "血紅素", unit: "g/dL" },
      { key: "Hct", label: "血球比容", unit: "%" },
      { key: "MCV", label: "MCV", unit: "fL" },
      { key: "MCH", label: "MCH", unit: "pg" },
      { key: "MCHC", label: "MCHC", unit: "g/dL" },
      { key: "PLT", label: "血小板", unit: "10³/µL" },
    ],
  },
  {
    title: "血脂 (Lipid)",
    items: [
      { key: "TG", label: "三酸甘油酯", unit: "mg/dL" },
      { key: "TC", label: "總膽固醇", unit: "mg/dL" },
      { key: "HDL", label: "高密度膽固醇", unit: "mg/dL" },
      { key: "LDL", label: "低密度膽固醇", unit: "mg/dL" },
    ],
  },
  {
    title: "腎功能 (Renal)",
    items: [
      { key: "BUN", label: "尿素氮", unit: "mg/dL" },
      { key: "Cr", label: "肌酸酐", unit: "mg/dL" },
      { key: "UA", label: "尿酸", unit: "mg/dL" },
      { key: "eGFR", label: "腎絲球過濾率", unit: "mL/min" },
    ],
  },
  {
    title: "血糖 (Glucose)",
    items: [
      { key: "AC_Sugar", label: "空腹血糖", unit: "mg/dL" },
      { key: "PC_Sugar", label: "飯後血糖", unit: "mg/dL" },
      { key: "HbA1c", label: "糖化血色素", unit: "%" },
    ],
  },
  {
    title: "肝膽胰 (Liver)",
    items: [
      { key: "Amylase", label: "澱粉酶", unit: "U/L" },
      { key: "TBil", label: "總膽紅素", unit: "mg/dL" },
      { key: "DBil", label: "直接膽紅素", unit: "mg/dL" },
      { key: "AST", label: "AST (GOT)", unit: "U/L" },
      { key: "ALT", label: "ALT (GPT)", unit: "U/L" },
      { key: "GGT", label: "γ-GT", unit: "U/L" },
      { key: "ALP", label: "鹼性磷酸酶", unit: "U/L" },
      { key: "TP", label: "總蛋白", unit: "g/dL" },
      { key: "Alb", label: "白蛋白", unit: "g/dL" },
      { key: "Glob", label: "球蛋白", unit: "g/dL" },
    ],
  },
  {
    title: "電解質 (Electrolytes)",
    items: [
      { key: "Na", label: "鈉", unit: "mmol/L" },
      { key: "K", label: "鉀", unit: "mmol/L" },
    ],
  },
];

function abnormalCount(lab: Record<string, LabValue> | null): number {
  if (!lab) return 0;
  return Object.values(lab).filter((v) => v && (v.flag === "H" || v.flag === "L")).length;
}

export default function BloodTestReportsPage() {
  const { role } = usePermissions();
  const isSuper = role === "super_admin";

  const [rows, setRows] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [allTenants, setAllTenants] = useState(false);
  const [patientFilter, setPatientFilter] = useState<SearchHit | null>(null);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  // 同步狀態
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      const data = await fetchAPI<ReportItem[]>(`/blood-test-reports/records?${qs.toString()}`);
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

  const triggerSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const qs = patientFilter ? `?patient_id=${patientFilter.id}` : "";
      await fetchAPI(`/blood-test-reports/sync${qs}`, { method: "POST" });
      setNotice(
        patientFilter
          ? `已開始同步 ${patientFilter.name} 的抽血報告（背景執行，數十秒後重新整理可看到新資料）`
          : "已開始同步整個診所的抽血報告（背景執行，完成需數十秒～數分鐘，稍後重新整理）",
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setNotice("沒有觸發同步的權限");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold">抽血報告</h1>
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
          onClick={triggerSync}
          disabled={syncing}
          className={`text-sm px-3 py-1 rounded text-white disabled:opacity-50 ${
            isSuper ? "ml-0" : "ml-auto"
          } bg-red-700 hover:bg-red-800`}
        >
          {syncing ? "同步啟動中…" : patientFilter ? "同步此病患" : "同步全部"}
        </button>
        <button
          onClick={load}
          className="text-sm px-3 py-1 border rounded hover:bg-gray-100"
        >
          重新整理
        </button>
      </div>

      {notice && (
        <div className="bg-teal-50 text-teal-800 p-3 rounded mb-3 text-sm">{notice}</div>
      )}

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
          {patientFilter ? "此病患尚無抽血報告，可按「同步此病患」抓取" : "目前沒有抽血報告，可按「同步全部」抓取"}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="p-3">檢驗日期</th>
                  <th className="p-3">病患</th>
                  <th className="p-3">病歷號</th>
                  <th className="p-3">診所</th>
                  {isSuper && allTenants && <th className="p-3">Tenant</th>}
                  <th className="p-3 text-right">異常項目</th>
                  <th className="p-3 text-right">明細</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ab = abnormalCount(r.lab_values);
                  const open = expanded === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="border-t">
                        <td className="p-3 whitespace-nowrap">
                          {new Date(r.test_date).toLocaleDateString("zh-TW")}
                        </td>
                        <td className="p-3 font-medium">{r.patient_name ?? `#${r.patient_id}`}</td>
                        <td className="p-3 font-mono text-xs">{r.chart_no ?? "—"}</td>
                        <td className="p-3">{r.clinic_name ?? "—"}</td>
                        {isSuper && allTenants && <td className="p-3 text-xs">{r.tenant_id}</td>}
                        <td className="p-3 text-right">
                          {ab > 0 ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
                              {ab} 項異常
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">正常</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => setExpanded(open ? null : r.id)}
                            className="text-xs text-red-700 hover:underline"
                          >
                            {open ? "收合" : "展開"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t bg-gray-50">
                          <td colSpan={isSuper && allTenants ? 7 : 6} className="p-4">
                            <LabDetail lab={r.lab_values} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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

function LabDetail({ lab }: { lab: Record<string, LabValue> | null }) {
  if (!lab || Object.keys(lab).length === 0) {
    return <div className="text-sm text-gray-400">此報告沒有可顯示的檢驗數據</div>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {LAB_GROUPS.map((group) => {
        const present = group.items.filter((it) => lab[it.key]?.value != null);
        if (present.length === 0) return null;
        return (
          <div key={group.title} className="bg-white rounded border border-gray-200 p-3">
            <div className="text-xs font-semibold text-gray-500 mb-2">{group.title}</div>
            <div className="space-y-1">
              {present.map((it) => {
                const v = lab[it.key];
                return (
                  <div key={it.key} className="flex items-baseline justify-between text-sm">
                    <span className="text-gray-600">{it.label}</span>
                    <span className="font-mono">
                      <FlagValue v={v} />
                      {it.unit && <span className="ml-1 text-[10px] text-gray-400">{it.unit}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlagValue({ v }: { v: LabValue }) {
  const cls =
    v.flag === "H"
      ? "text-red-600 font-semibold"
      : v.flag === "L"
        ? "text-blue-600 font-semibold"
        : "text-gray-800";
  return (
    <span className={cls}>
      {v.value ?? "—"}
      {v.flag && <span className="ml-0.5 text-[10px]">{v.flag}</span>}
    </span>
  );
}
