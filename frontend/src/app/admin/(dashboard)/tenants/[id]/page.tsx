"use client";

import { useParams, useRouter } from "next/navigation";
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

type Service = { id: number; name: string; prefix: string };
type Role = { id: number; name: string };

type Tab = "overview" | "services" | "roles";

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tenantId = Number(params.id);

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [enabledServices, setEnabledServices] = useState<Set<number>>(new Set());
  const [enabledRoles, setEnabledRoles] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [tRes, sRes, rRes, tsRes, trRes] = await Promise.all([
        fetch(`/auth/v1/admin/tenants/${tenantId}`, { credentials: "include" }),
        fetch(`/auth/v1/admin/services`, { credentials: "include" }),
        fetch(`/auth/v1/admin/roles`, { credentials: "include" }),
        fetch(`/auth/v1/admin/tenants/${tenantId}/services`, { credentials: "include" }),
        fetch(`/auth/v1/admin/tenants/${tenantId}/roles`, { credentials: "include" }),
      ]);
      if (!tRes.ok) throw new Error("tenant 不存在");
      setTenant(await tRes.json());
      setAllServices((await sRes.json()).services ?? []);
      setAllRoles(((await rRes.json()).roles ?? []).map((r: any) => ({ id: r.id, name: r.name })));
      setEnabledServices(new Set((await tsRes.json()).service_ids ?? []));
      setEnabledRoles(new Set((await trRes.json()).role_ids ?? []));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tenantId]);

  const toggleService = (id: number) => {
    const next = new Set(enabledServices);
    next.has(id) ? next.delete(id) : next.add(id);
    setEnabledServices(next);
  };

  const toggleRole = (id: number) => {
    const next = new Set(enabledRoles);
    next.has(id) ? next.delete(id) : next.add(id);
    setEnabledRoles(next);
  };

  const saveOverview = async (patch: { name?: string; active?: boolean }) => {
    setSaving(true);
    try {
      const res = await fetch(`/auth/v1/admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e: any) {
      alert(`儲存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveServices = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/auth/v1/admin/tenants/${tenantId}/services`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ service_ids: Array.from(enabledServices) }),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e: any) {
      alert(`儲存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveRoles = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/auth/v1/admin/tenants/${tenantId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role_ids: Array.from(enabledRoles) }),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e: any) {
      alert(`儲存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-500">載入中…</div>;
  if (error || !tenant) return <div className="bg-red-50 text-red-700 p-3 rounded">錯誤：{error}</div>;

  const locked = tenant.locked;

  return (
    <div>
      <div className="mb-4">
        <div className="text-sm text-gray-500">
          <a href="/admin/tenants" className="hover:underline">← 回到租戶列表</a>
        </div>
        <h1 className="text-xl font-bold mt-1">
          <span className="font-mono text-base text-red-700">{tenant.slug}</span>
          <span className="ml-2">{tenant.name}</span>
          {locked && <span className="ml-2 text-sm text-gray-500">🔒 系統租戶（唯讀）</span>}
          {!tenant.active && <span className="ml-2 text-sm text-gray-500">（已停用）</span>}
        </h1>
      </div>

      {/* Tabs */}
      <div className="border-b mb-4 flex gap-1">
        {[
          ["overview", "基本資訊"],
          ["services", `服務 (${enabledServices.size}/${allServices.length})`],
          ["roles", `角色 (${enabledRoles.size}/${allRoles.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as Tab)}
            className={`px-4 py-2 text-sm ${
              tab === key
                ? "border-b-2 border-red-700 text-red-700 font-semibold"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4 max-w-lg">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Slug</label>
            <input value={tenant.slug} readOnly className="w-full border rounded px-3 py-2 bg-gray-50 font-mono text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">顯示名稱</label>
            <input
              defaultValue={tenant.name}
              disabled={locked}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== tenant.name) saveOverview({ name: v });
              }}
              className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">啟用狀態</label>
            <button
              disabled={locked || saving}
              onClick={() => saveOverview({ active: !tenant.active })}
              className={`text-xs px-3 py-1 rounded ${
                tenant.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
              }`}
            >
              {tenant.active ? "啟用中（按一下停用）" : "已停用（按一下啟用）"}
            </button>
          </div>
          <div className="pt-3 border-t text-xs text-gray-500 space-y-1">
            <div>服務訂閱：{tenant.service_count}</div>
            <div>角色訂閱：{tenant.role_count}</div>
            <div>使用者數：{tenant.user_count}</div>
          </div>
        </div>
      )}

      {tab === "services" && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-sm text-gray-500 mb-3">
            勾選該租戶能用的 service。未勾選的 service 下所有 action 都會被擋（engine 先擋）。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {allServices.map((s) => (
              <label key={s.id} className="flex items-center text-sm p-2 border rounded">
                <input
                  type="checkbox"
                  checked={enabledServices.has(s.id)}
                  onChange={() => toggleService(s.id)}
                  disabled={locked}
                  className="mr-3"
                />
                <div>
                  <div className="font-mono">{s.name}</div>
                  <div className="text-xs text-gray-500">prefix: {s.prefix || "（空）"}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <button
              onClick={saveServices}
              disabled={locked || saving}
              className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
            >
              {saving ? "儲存中…" : "儲存服務訂閱"}
            </button>
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-sm text-gray-500 mb-3">
            勾選此租戶可發的角色。建立 user 時選 tenant 後，role 選單會依此 filter。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {allRoles.map((r) => (
              <label key={r.id} className="flex items-center text-sm p-2 border rounded">
                <input
                  type="checkbox"
                  checked={enabledRoles.has(r.id)}
                  onChange={() => toggleRole(r.id)}
                  disabled={locked}
                  className="mr-3"
                />
                <span className="font-mono">{r.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <button
              onClick={saveRoles}
              disabled={locked || saving}
              className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
            >
              {saving ? "儲存中…" : "儲存角色訂閱"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
