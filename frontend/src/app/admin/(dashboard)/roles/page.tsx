"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Role = {
  id: number;
  name: string;
  user_count: number;
  policy_count: number;
  locked: boolean;
};

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/auth/v1/admin/roles", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRoles((await res.json()).roles ?? []);
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

  const createRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    const res = await fetch("/auth/v1/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      alert(`建立失敗：${await res.text()}`);
      return;
    }
    setNewName("");
    load();
  };

  const deleteRole = async (role: Role) => {
    if (role.locked) return;
    if (!confirm(`確定刪除角色「${role.name}」？`)) return;
    const res = await fetch(`/auth/v1/admin/roles/${role.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      alert(`刪除失敗：${await res.text()}`);
      return;
    }
    load();
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">角色管理</h1>

      <form onSubmit={createRole} className="bg-white rounded-lg shadow-sm p-4 mb-4 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新角色名稱（小寫英數 + 底線，如 doctor）"
          pattern="^[a-z][a-z0-9_]{1,49}$"
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-red-700 text-white px-4 py-2 rounded text-sm hover:bg-red-800">
          新增角色
        </button>
      </form>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">名稱</th>
                <th className="p-3">使用者數</th>
                <th className="p-3">Policy 數</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{r.id}</td>
                  <td className="p-3 font-medium">
                    {r.name}
                    {r.locked && <span className="ml-2 text-xs text-gray-500">🔒 系統角色</span>}
                  </td>
                  <td className="p-3">{r.user_count}</td>
                  <td className="p-3">{r.policy_count}</td>
                  <td className="p-3 space-x-2">
                    <Link href={`/admin/roles/${r.id}`} className="text-red-700 hover:underline text-xs">
                      編輯 Policy
                    </Link>
                    <button
                      disabled={r.locked || r.user_count > 0}
                      onClick={() => deleteRole(r)}
                      className="text-xs text-red-600 disabled:text-gray-300"
                      title={
                        r.locked
                          ? "系統角色不可刪除"
                          : r.user_count > 0
                            ? "仍有使用者綁定此角色"
                            : ""
                      }
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-400">
                    尚無角色
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
