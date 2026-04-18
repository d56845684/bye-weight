"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Policy = {
  id: number;
  name: string;
  document: any;
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/auth/v1/admin/policies", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPolicies((await res.json()).policies ?? []);
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

  const summarize = (doc: any): string => {
    try {
      const actions = (doc?.statements ?? []).flatMap((s: any) => s.actions ?? []);
      return actions.slice(0, 3).join(", ") + (actions.length > 3 ? ` (+${actions.length - 3})` : "");
    } catch {
      return "—";
    }
  };

  return (
    <div>
      <div className="flex items-center mb-4">
        <h1 className="text-xl font-bold">Policy 管理</h1>
        <button onClick={load} className="ml-auto text-sm px-3 py-1 border rounded hover:bg-gray-100">
          重新整理
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">名稱</th>
                <th className="p-3">允許的 actions（前 3 個）</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.id}</td>
                  <td className="p-3 font-mono">{p.name}</td>
                  <td className="p-3 text-xs text-gray-600 font-mono">{summarize(p.document)}</td>
                  <td className="p-3">
                    <Link
                      href={`/admin/policies/${p.id}`}
                      className="text-red-700 hover:underline text-xs"
                    >
                      編輯
                    </Link>
                  </td>
                </tr>
              ))}
              {policies.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-400">
                    尚無 policy
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
