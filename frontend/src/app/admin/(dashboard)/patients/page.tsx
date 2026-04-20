"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

type Patient = {
  id: number;
  auth_user_id: number | null;
  tenant_id: number;
  name: string;
  sex: string | null;
  birth_date: string;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
  chart_no: string | null;
  his_id: string | null;
};

export default function ClinicPatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const path = q && q.trim() ? `/patients?q=${encodeURIComponent(q.trim())}` : "/patients";
      const data = await fetchAPI<{ patients: Patient[] }>(path);
      setPatients(data.patients ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const softDelete = async (p: Patient) => {
    if (!confirm(`軟刪除「${p.name}」（#${p.id}）？\n資料保留在 DB，只標記 deleted_at。`)) return;
    try {
      const res = await fetch(`/api/v1/patients/${p.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      load(query);
    } catch (e: any) {
      alert(`刪除失敗：${e.message}`);
    }
  };

  return (
    <div>
      <div className="flex items-center mb-4 gap-3">
        <h1 className="text-xl font-bold">病患管理</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(query)}
          placeholder="搜尋姓名…"
          className="border rounded px-3 py-1 text-sm w-64"
        />
        <button
          onClick={() => load(query)}
          className="text-sm px-3 py-1 border rounded hover:bg-gray-100"
        >
          搜尋
        </button>
        <Link
          href="/admin/patients/new"
          className="ml-auto text-sm px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800"
        >
          + 新增病患
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">病歷號</th>
                <th className="p-3">姓名</th>
                <th className="p-3">性別</th>
                <th className="p-3">生日</th>
                <th className="p-3">電話</th>
                <th className="p-3">HIS ID</th>
                <th className="p-3">LINE</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.id}</td>
                  <td className="p-3 font-mono text-xs">{p.chart_no ?? "—"}</td>
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3">{p.sex ?? "—"}</td>
                  <td className="p-3">{p.birth_date}</td>
                  <td className="p-3">{p.phone ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{p.his_id ?? "—"}</td>
                  <td className="p-3">
                    {p.auth_user_id ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">已綁</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">未綁</span>
                    )}
                  </td>
                  <td className="p-3 space-x-3">
                    <Link
                      href={`/admin/patients/${p.id}`}
                      className="text-xs text-red-700 hover:underline"
                    >
                      編輯
                    </Link>
                    <button
                      onClick={() => softDelete(p)}
                      className="text-xs text-gray-500 hover:text-red-700 hover:underline"
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
              {patients.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-gray-400">
                    {query ? "找不到符合條件的病患" : "尚無病患，點「新增病患」建立第一筆"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
