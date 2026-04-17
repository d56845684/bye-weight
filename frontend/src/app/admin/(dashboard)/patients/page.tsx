"use client";

import { useEffect, useState } from "react";

type Patient = {
  id: number;
  name: string;
  sex: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
};

export default function AdminPatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patients", { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPatients(data.patients ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">病患管理</h1>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">姓名</th>
                <th className="p-3">性別</th>
                <th className="p-3">生日</th>
                <th className="p-3">電話</th>
                <th className="p-3">Email</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.id}</td>
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3">{p.sex ?? "-"}</td>
                  <td className="p-3">{p.birth_date ?? "-"}</td>
                  <td className="p-3">{p.phone ?? "-"}</td>
                  <td className="p-3">{p.email ?? "-"}</td>
                </tr>
              ))}
              {patients.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-400">
                    尚無病患資料
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
