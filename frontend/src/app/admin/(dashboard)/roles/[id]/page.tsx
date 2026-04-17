"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Permission = {
  id: number;
  name: string;
  resource: string;
  action: string;
};

export default function RolePermissionsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const roleId = params.id;

  const [roleName, setRoleName] = useState<string>("");
  const [locked, setLocked] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [permsRes, rolePermsRes, rolesRes] = await Promise.all([
          fetch("/auth/admin/permissions", { credentials: "include" }),
          fetch(`/auth/admin/roles/${roleId}/permissions`, { credentials: "include" }),
          fetch("/auth/admin/roles", { credentials: "include" }),
        ]);
        if (!permsRes.ok || !rolePermsRes.ok || !rolesRes.ok) {
          throw new Error("載入失敗");
        }
        const perms = (await permsRes.json()).permissions as Permission[];
        const ids = (await rolePermsRes.json()).permission_ids as number[];
        const roles = (await rolesRes.json()).roles as { id: number; name: string; locked: boolean }[];
        const me = roles.find((r) => r.id === Number(roleId));
        setPermissions(perms);
        setSelected(new Set(ids));
        setRoleName(me?.name ?? `#${roleId}`);
        setLocked(me?.name === "super_admin");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [roleId]);

  const grouped = useMemo(() => {
    const g: Record<string, Permission[]> = {};
    for (const p of permissions) {
      (g[p.resource] ||= []).push(p);
    }
    return g;
  }, [permissions]);

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleResource = (resource: string, on: boolean) => {
    const next = new Set(selected);
    for (const p of grouped[resource]) {
      if (on) next.add(p.id);
      else next.delete(p.id);
    }
    setSelected(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/auth/admin/roles/${roleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ permission_ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/admin/roles");
    } catch (e: any) {
      alert(`儲存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-500">載入中…</div>;
  if (error) return <div className="bg-red-50 text-red-700 p-3 rounded">錯誤：{error}</div>;

  return (
    <div>
      <div className="flex items-center mb-4">
        <div>
          <div className="text-sm text-gray-500">
            <a href="/admin/roles" className="hover:underline">← 回到角色列表</a>
          </div>
          <h1 className="text-xl font-bold mt-1">
            編輯權限：<span className="text-red-700">{roleName}</span>
            {locked && <span className="ml-2 text-sm text-gray-500">🔒 系統角色（只讀）</span>}
          </h1>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          已選 {selected.size} / {permissions.length}
        </div>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([resource, perms]) => {
          const all = perms.every((p) => selected.has(p.id));
          const some = perms.some((p) => selected.has(p.id));
          return (
            <div key={resource} className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center mb-2 pb-2 border-b">
                <label className="font-semibold text-sm">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = some && !all;
                    }}
                    onChange={(e) => toggleResource(resource, e.target.checked)}
                    disabled={locked}
                    className="mr-2"
                  />
                  {resource}
                </label>
                <span className="ml-2 text-xs text-gray-400">
                  ({perms.filter((p) => selected.has(p.id)).length} / {perms.length})
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {perms.map((p) => (
                  <label key={p.id} className="flex items-center text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={locked}
                      className="mr-2"
                    />
                    <span className="font-mono text-xs">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={save}
          disabled={saving || locked}
          className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        <button
          onClick={() => router.push("/admin/roles")}
          className="px-6 py-2 border rounded hover:bg-gray-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}
