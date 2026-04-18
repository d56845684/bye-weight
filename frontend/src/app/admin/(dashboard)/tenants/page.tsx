"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Tenant = {
  id: number;
  slug: string;
  name: string;
  active: boolean;
  service_count: number;
  role_count: number;
  user_count: number;
  locked: boolean;
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "" });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/auth/v1/admin/tenants", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTenants((await res.json()).tenants ?? []);
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

  const createTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/auth/v1/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowCreate(false);
      setForm({ slug: "", name: "" });
      load();
    } catch (e: any) {
      alert(`建立失敗：${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (t: Tenant) => {
    if (t.locked) return;
    const res = await fetch(`/auth/v1/admin/tenants/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ active: !t.active }),
    });
    if (!res.ok) {
      alert(`切換失敗：${await res.text()}`);
      return;
    }
    load();
  };

  return (
    <div>
      <div className="flex items-center mb-4">
        <h1 className="text-xl font-bold">租戶管理</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="text-sm px-3 py-1 border rounded hover:bg-gray-100">
            重新整理
          </button>
          <button
            onClick={async () => {
              const res = await fetch("/auth/v1/admin/invalidate", {
                method: "POST",
                credentials: "include",
              });
              alert(res.ok ? "已刷新權限快取" : `失敗：${await res.text()}`);
            }}
            className="text-sm px-3 py-1 border rounded hover:bg-gray-100"
            title="改完 policy / action_mapping / tenant_services 後按一下立即生效（否則最多等 5 分鐘）"
          >
            🔄 刷新權限快取
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800"
          >
            + 新增租戶
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">Slug</th>
                <th className="p-3">名稱</th>
                <th className="p-3">服務</th>
                <th className="p-3">角色</th>
                <th className="p-3">使用者</th>
                <th className="p-3">狀態</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-3">{t.id}</td>
                  <td className="p-3 font-mono text-xs">
                    {t.slug}
                    {t.locked && <span className="ml-2 text-gray-400">🔒</span>}
                  </td>
                  <td className="p-3">{t.name}</td>
                  <td className="p-3">{t.service_count}</td>
                  <td className="p-3">{t.role_count}</td>
                  <td className="p-3">{t.user_count}</td>
                  <td className="p-3">
                    <button
                      disabled={t.locked}
                      onClick={() => toggleActive(t)}
                      className={`text-xs px-2 py-1 rounded ${
                        t.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                      } ${t.locked ? "opacity-60" : ""}`}
                      title={t.locked ? "系統租戶不可變更" : ""}
                    >
                      {t.active ? "啟用" : "停用"}
                    </button>
                  </td>
                  <td className="p-3">
                    {!t.locked && (
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="text-red-700 hover:underline text-xs"
                      >
                        編輯訂閱
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-gray-400">
                    尚無租戶
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={createTenant}
            className="bg-white rounded-lg p-6 w-full max-w-md space-y-3"
          >
            <h2 className="text-lg font-bold">新增租戶</h2>
            <p className="text-xs text-gray-500">
              建立後會自動訂閱 auth / main / frontend 三個服務，並開放 patient / staff /
              nutritionist / admin 四個角色。super_admin 與 admin service 預設不給，需手動訂閱。
            </p>
            <div>
              <label className="block text-sm mb-1">Slug *（英數 + 連字號）</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                required
                pattern="^[a-z][a-z0-9-]{1,49}$"
                placeholder="例：clinic-taipei"
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">顯示名稱 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="例：台北診所"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 bg-red-700 text-white py-2 rounded hover:bg-red-800 disabled:opacity-50"
              >
                {creating ? "建立中…" : "建立"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 border rounded py-2 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
