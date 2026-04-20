"use client";

import { useEffect, useMemo, useState } from "react";

type Mapping = {
  id: number;
  service_id: number;
  service_name: string;
  http_method: string;
  url_pattern: string;
  action: string;
  resource_template: string;
};

type Service = { id: number; name: string; prefix: string };

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof HTTP_METHODS)[number];

type FormState = {
  id?: number;
  service_id: number;
  http_method: Method;
  url_pattern: string;
  action: string;
  resource_template: string;
};

const EMPTY_FORM: FormState = {
  service_id: 0,
  http_method: "GET",
  url_pattern: "",
  action: "",
  resource_template: "",
};

export default function ActionMappingsPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // modal state：新增 / 編輯
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [mRes, sRes] = await Promise.all([
        fetch(`/auth/v1/admin/action-mappings${serviceFilter ? `?service=${serviceFilter}` : ""}`, {
          credentials: "include",
        }),
        fetch("/auth/v1/admin/services", { credentials: "include" }),
      ]);
      if (!mRes.ok) throw new Error(`讀取失敗：${mRes.status}`);
      setMappings(((await mRes.json()).mappings ?? []) as Mapping[]);
      if (sRes.ok) setServices(((await sRes.json()).services ?? []) as Service[]);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceFilter]);

  // 依 service 分組顯示
  const grouped = useMemo(() => {
    const g: Record<string, Mapping[]> = {};
    for (const m of mappings) {
      (g[m.service_name] ||= []).push(m);
    }
    return g;
  }, [mappings]);

  const openCreate = () => {
    setEditing({
      ...EMPTY_FORM,
      service_id: services[0]?.id ?? 0,
    });
  };

  const openEdit = (m: Mapping) => {
    setEditing({
      id: m.id,
      service_id: m.service_id,
      http_method: m.http_method as Method,
      url_pattern: m.url_pattern,
      action: m.action,
      resource_template: m.resource_template,
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const isEdit = editing.id != null;
      const url = isEdit
        ? `/auth/v1/admin/action-mappings/${editing.id}`
        : `/auth/v1/admin/action-mappings`;
      const body = isEdit
        ? {
            http_method: editing.http_method,
            url_pattern: editing.url_pattern,
            action: editing.action,
            resource_template: editing.resource_template,
          }
        : editing;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text();
        if (res.status === 403) throw new Error(`無權限（${isEdit ? "修改" : "新增"} action_mapping）`);
        throw new Error(msg);
      }
      setEditing(null);
      load();
    } catch (e: any) {
      alert(`儲存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const del = async (m: Mapping) => {
    if (!confirm(`刪除 action_mapping #${m.id}？\n\n${m.http_method} ${m.url_pattern}\n→ ${m.action}\n\n硬刪除，不可恢復（要恢復請從 SQL / migration 重建）。`))
      return;
    try {
      const res = await fetch(`/auth/v1/admin/action-mappings/${m.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error("無權限刪除");
        throw new Error(await res.text());
      }
      load();
    } catch (e: any) {
      alert(`刪除失敗：${e.message}`);
    }
  };

  return (
    <div>
      <div className="flex items-center mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold">Action Mapping 管理</h1>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="">所有服務</option>
          {services.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={load} className="text-sm px-3 py-1 border rounded hover:bg-gray-100">
          重新整理
        </button>
        <button
          onClick={openCreate}
          disabled={services.length === 0}
          className="ml-auto text-sm px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-50"
        >
          + 新增 mapping
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        修改 action_mapping 會自動呼叫 engine 重建 cache，立即生效。URL pattern 支援
        <code className="bg-gray-100 px-1">{"{id}"}</code> path 變數與尾端{" "}
        <code className="bg-gray-100 px-1">/*</code> 萬用字元；resource_template 支援{" "}
        <code className="bg-gray-100 px-1">${"{auth:user_id}"}</code>、
        <code className="bg-gray-100 px-1">${"{auth:tenant_id}"}</code>、
        <code className="bg-gray-100 px-1">${"{path.id}"}</code> 等變數。
      </p>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && (
        <div className="space-y-6">
          {Object.keys(grouped).sort().map((svcName) => (
            <div key={svcName} className="bg-white rounded-lg shadow-sm overflow-x-auto">
              <div className="bg-gray-50 px-3 py-2 border-b text-sm font-semibold">
                <span className="font-mono text-red-700">{svcName}</span>
                <span className="ml-2 text-gray-500">({grouped[svcName].length} rules)</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-gray-100 text-left">
                  <tr>
                    <th className="p-2 w-16">ID</th>
                    <th className="p-2 w-20">Method</th>
                    <th className="p-2">URL Pattern</th>
                    <th className="p-2">Action</th>
                    <th className="p-2">Resource Template</th>
                    <th className="p-2 w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[svcName].map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="p-2">{m.id}</td>
                      <td className="p-2 font-mono">{m.http_method}</td>
                      <td className="p-2 font-mono">{m.url_pattern}</td>
                      <td className="p-2 font-mono text-red-700">{m.action}</td>
                      <td className="p-2 font-mono text-gray-600">{m.resource_template}</td>
                      <td className="p-2 space-x-2">
                        <button onClick={() => openEdit(m)} className="text-red-700 hover:underline">
                          編輯
                        </button>
                        <button onClick={() => del(m)} className="text-gray-500 hover:text-red-700 hover:underline">
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {Object.keys(grouped).length === 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-400">
              尚無 mapping
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-xl space-y-3">
            <h2 className="text-lg font-bold">
              {editing.id != null ? `編輯 mapping #${editing.id}` : "新增 mapping"}
            </h2>

            <div>
              <label className="block text-xs mb-1">Service</label>
              <select
                value={editing.service_id}
                onChange={(e) => setEditing({ ...editing, service_id: Number(e.target.value) })}
                disabled={editing.id != null}
                className="w-full border rounded px-2 py-1 text-sm disabled:bg-gray-50"
                title={editing.id != null ? "不能在編輯時搬 service，要搬請刪除後重建" : ""}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (prefix: {s.prefix || "（空）"})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs mb-1">HTTP Method</label>
              <select
                value={editing.http_method}
                onChange={(e) => setEditing({ ...editing, http_method: e.target.value as Method })}
                className="w-full border rounded px-2 py-1 text-sm"
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs mb-1">URL Pattern（含 service prefix 後的完整路徑）</label>
              <input
                value={editing.url_pattern}
                onChange={(e) => setEditing({ ...editing, url_pattern: e.target.value })}
                placeholder="例：/patients 或 /auth/v1/admin/users/{id}"
                className="w-full border rounded px-2 py-1 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs mb-1">Action</label>
              <input
                value={editing.action}
                onChange={(e) => setEditing({ ...editing, action: e.target.value })}
                placeholder="例：main:patient:read"
                className="w-full border rounded px-2 py-1 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs mb-1">Resource Template</label>
              <input
                value={editing.resource_template}
                onChange={(e) => setEditing({ ...editing, resource_template: e.target.value })}
                placeholder="例：main:tenant/${auth:tenant_id}/patient/${path.id}"
                className="w-full border rounded px-2 py-1 text-sm font-mono"
              />
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <button
                onClick={save}
                disabled={saving}
                className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
              >
                {saving ? "儲存中…" : "儲存"}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="ml-auto px-6 py-2 border rounded hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
