"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type User = {
  id: number;
  display_name: string | null;
  line_uuid: string | null;
  google_email: string | null;
  role: string;
  tenant_id: number;
  tenant_slug: string;
  active: boolean;
  binding_status: "bound" | "pending" | "password_only";
};

type Tenant = {
  id: number;
  slug: string;
  name: string;
  active: boolean;
};

type BindingResult = {
  user_id: number;
  binding_token: string;
  binding_url: string;
  expires_at: string;
};

type RoleObj = { id: number; name: string };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleObj[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantRoleIds, setTenantRoleIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 新增表單
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ display_name: "", role: "patient", tenant_id: 1 });
  const [creating, setCreating] = useState(false);

  // 綁定連結 modal
  const [binding, setBinding] = useState<BindingResult | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, tenantsRes] = await Promise.all([
        fetch("/auth/v1/admin/users", { credentials: "include" }),
        fetch("/auth/v1/admin/roles", { credentials: "include" }),
        fetch("/auth/v1/admin/tenants", { credentials: "include" }),
      ]);
      if (!usersRes.ok || !rolesRes.ok || !tenantsRes.ok) throw new Error(`HTTP ${usersRes.status}`);
      setUsers((await usersRes.json()).users ?? []);
      setRoles(((await rolesRes.json()).roles ?? []).map((r: any) => ({ id: r.id, name: r.name })));
      setTenants((await tenantsRes.json()).tenants ?? []);
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

  // 當 form.tenant_id 改變時 fetch 該 tenant 訂閱的 role id 集合
  useEffect(() => {
    if (!showCreate || form.tenant_id === 0) {
      setTenantRoleIds(new Set());
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/auth/v1/admin/tenants/${form.tenant_id}/roles`, {
          credentials: "include",
        });
        if (!res.ok) return;
        setTenantRoleIds(new Set((await res.json()).role_ids ?? []));
      } catch {
        setTenantRoleIds(new Set());
      }
    })();
  }, [form.tenant_id, showCreate]);

  const updateUser = async (id: number, patch: Partial<User>) => {
    const res = await fetch(`/auth/v1/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      alert(`更新失敗：${await res.text()}`);
      return;
    }
    load();
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.display_name) return;
    setCreating(true);
    try {
      const res = await fetch("/auth/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: BindingResult = await res.json();
      setBinding(data);
      setShowCreate(false);
      setForm({ display_name: "", role: "patient", tenant_id: tenants[0]?.id ?? 1 });
      load();
    } catch (e: any) {
      alert(`建立失敗：${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const regenerate = async (id: number) => {
    const res = await fetch(`/auth/v1/admin/users/${id}/binding-token`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      alert(`產生失敗：${await res.text()}`);
      return;
    }
    setBinding(await res.json());
  };

  const unbind = async (u: User) => {
    const label = u.display_name || `#${u.id}`;
    if (!confirm(`解除 ${label} 的 LINE 綁定後，其手機上的 session 會立即失效且帳號被停用。\n要重新啟用需重發綁定連結。確定？`))
      return;
    const res = await fetch(`/auth/v1/admin/users/${u.id}/unbind`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      alert(`解除綁定失敗：${await res.text()}`);
      return;
    }
    load();
  };

  const setPassword = async (u: User) => {
    const label = u.display_name || `#${u.id}`;
    const email = prompt(`設定「${label}」的登入 email：`, u.google_email ?? "");
    if (!email) return;
    const password = prompt("初始密碼（至少 8 碼）：");
    if (!password || password.length < 8) {
      if (password !== null) alert("密碼至少 8 碼");
      return;
    }
    const res = await fetch(`/auth/v1/admin/users/${u.id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      alert(`設定失敗：${await res.text()}`);
      return;
    }
    alert(`已設定 ${label} 的 email / 密碼，現有 session 全部失效`);
    load();
  };

  const softDelete = async (u: User) => {
    const label = u.display_name || `#${u.id}`;
    if (!confirm(`軟刪除 ${label}？\n\n動作：停用帳號、清掉 LINE 綁定、現有 session 全部失效。\n記錄保留於 DB（deleted_at / deleted_by），未來可恢復。\n\n確定？`))
      return;
    const res = await fetch(`/auth/v1/admin/users/${u.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      alert(`刪除失敗：${await res.text()}`);
      return;
    }
    load();
  };

  const absoluteURL = (u: string) =>
    u.startsWith("http") ? u : `${window.location.origin}${u}`;

  const realTenants = tenants.filter((t) => t.id !== 0);

  return (
    <div>
      <div className="flex items-center mb-4">
        <h1 className="text-xl font-bold">使用者管理</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="text-sm px-3 py-1 border rounded hover:bg-gray-100">
            重新整理
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800"
          >
            + 新增 user（產綁定連結）
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
                <th className="p-3">名稱</th>
                <th className="p-3">綁定</th>
                <th className="p-3">角色</th>
                <th className="p-3">Tenant</th>
                <th className="p-3">狀態</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3">{u.id}</td>
                  <td className="p-3">
                    <input
                      defaultValue={u.display_name ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (u.display_name ?? "")) updateUser(u.id, { display_name: v });
                      }}
                      placeholder="—"
                      className="border rounded px-2 py-1 text-sm w-32"
                    />
                  </td>
                  <td className="p-3">
                    {u.binding_status === "bound" && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded w-fit">
                          已綁 LINE
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(u.line_uuid ?? "");
                          }}
                          title={`點擊複製：${u.line_uuid}`}
                          className="text-xs font-mono text-gray-500 hover:text-red-700 text-left"
                        >
                          {u.line_uuid ? `${u.line_uuid.slice(0, 6)}…${u.line_uuid.slice(-6)}` : ""}
                        </button>
                      </div>
                    )}
                    {u.binding_status === "pending" && (
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                        待綁定
                      </span>
                    )}
                    {u.binding_status === "password_only" && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded w-fit">
                          密碼帳號
                        </span>
                        <span className="text-xs text-gray-500">{u.google_email}</span>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value } as any)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <select
                      value={u.tenant_id}
                      onChange={(e) => updateUser(u.id, { tenant_id: Number(e.target.value) } as any)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id === 0 ? "system" : t.slug}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => updateUser(u.id, { active: !u.active } as any)}
                      className={`text-xs px-2 py-1 rounded ${
                        u.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {u.active ? "啟用" : "停用"}
                    </button>
                  </td>
                  <td className="p-3 space-x-3">
                    {u.binding_status === "pending" && (
                      <button
                        onClick={() => regenerate(u.id)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        產生綁定連結
                      </button>
                    )}
                    {u.binding_status === "bound" && (
                      <button
                        onClick={() => unbind(u)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        解除綁定
                      </button>
                    )}
                    <button
                      onClick={() => setPassword(u)}
                      disabled={u.role === "super_admin"}
                      title={u.role === "super_admin" ? "super_admin 請直接改 DB" : "設定 email + 密碼"}
                      className="text-xs text-gray-500 hover:text-red-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      設密碼
                    </button>
                    <button
                      onClick={() => softDelete(u)}
                      disabled={u.role === "super_admin"}
                      title={u.role === "super_admin" ? "super_admin 不可刪除" : "軟刪除"}
                      className="text-xs text-gray-500 hover:text-red-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增 user modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={createUser}
            className="bg-white rounded-lg p-6 w-full max-w-md space-y-3"
          >
            <h2 className="text-lg font-bold">新增 user</h2>
            <div>
              <label className="block text-sm mb-1">顯示名稱 *</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                required
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="例：王小明"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">角色</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                {roles
                  .filter((r) =>
                    form.tenant_id === 0
                      ? true  // system tenant 訂所有 role
                      : tenantRoleIds.size === 0
                        ? true  // 還沒 fetch 到，全顯示（避免空選單）
                        : tenantRoleIds.has(r.id),
                  )
                  .map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
              </select>
              {form.tenant_id !== 0 && tenantRoleIds.size > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  僅顯示此 tenant 已訂閱的角色（共 {tenantRoleIds.size} 個）
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm mb-1">Tenant</label>
              <select
                value={form.tenant_id}
                onChange={(e) => setForm({ ...form, tenant_id: Number(e.target.value) })}
                className="w-full border rounded px-3 py-2 text-sm"
                required
              >
                {form.role === "super_admin" && <option value={0}>system (0)</option>}
                {realTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.slug} · {t.name}
                  </option>
                ))}
              </select>
              {realTenants.length === 0 && form.role !== "super_admin" && (
                <p className="text-xs text-red-600 mt-1">尚無 tenant，請先到「租戶」建立。</p>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 bg-red-700 text-white py-2 rounded hover:bg-red-800 disabled:opacity-50"
              >
                {creating ? "建立中…" : "建立並產生連結"}
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

      {/* 綁定連結 modal */}
      {binding && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold">綁定連結已產生</h2>
            <p className="text-sm text-gray-600">
              將此連結或 QR 傳給使用者，7 天內在 LINE 內開啟即可綁定。
            </p>

            <div className="flex justify-center py-2">
              <QRCodeSVG value={absoluteURL(binding.binding_url)} size={200} />
            </div>

            <div>
              <label className="text-xs text-gray-500">連結</label>
              <input
                readOnly
                value={absoluteURL(binding.binding_url)}
                onFocus={(e) => e.target.select()}
                className="w-full border rounded px-3 py-2 text-xs font-mono bg-gray-50"
              />
            </div>
            <div className="text-xs text-gray-500">
              過期時間：{new Date(binding.expires_at).toLocaleString()}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(absoluteURL(binding.binding_url))}
                className="flex-1 border rounded py-2 text-sm hover:bg-gray-50"
              >
                複製連結
              </button>
              <button
                onClick={() => setBinding(null)}
                className="flex-1 bg-red-700 text-white rounded py-2 text-sm hover:bg-red-800"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
