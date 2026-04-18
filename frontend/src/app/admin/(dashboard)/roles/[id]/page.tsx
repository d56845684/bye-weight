"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Policy = {
  id: number;
  name: string;
  document: any;
};

export default function RolePoliciesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const roleId = params.id;

  const [roleName, setRoleName] = useState<string>("");
  const [locked, setLocked] = useState(false);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [policiesRes, rolePoliciesRes, rolesRes] = await Promise.all([
          fetch("/auth/v1/admin/policies", { credentials: "include" }),
          fetch(`/auth/v1/admin/roles/${roleId}/policies`, { credentials: "include" }),
          fetch("/auth/v1/admin/roles", { credentials: "include" }),
        ]);
        if (!policiesRes.ok || !rolePoliciesRes.ok || !rolesRes.ok) {
          throw new Error("載入失敗");
        }
        const pols = (await policiesRes.json()).policies as Policy[];
        const ids = (await rolePoliciesRes.json()).policy_ids as number[];
        const roles = (await rolesRes.json()).roles as { id: number; name: string; locked: boolean }[];
        const me = roles.find((r) => r.id === Number(roleId));
        setPolicies(pols);
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

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/auth/v1/admin/roles/${roleId}/policies`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ policy_ids: Array.from(selected) }),
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
            編輯 Policy：<span className="text-red-700">{roleName}</span>
            {locked && <span className="ml-2 text-sm text-gray-500">🔒 系統角色（只讀）</span>}
          </h1>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          已選 {selected.size} / {policies.length}
        </div>
      </div>

      <div className="space-y-3">
        {policies.map((p) => (
          <label
            key={p.id}
            className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-3 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
              disabled={locked}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-sm">{p.name}</div>
              <pre className="mt-2 text-xs bg-gray-50 p-2 rounded font-mono overflow-x-auto">
                {JSON.stringify(p.document, null, 2)}
              </pre>
            </div>
          </label>
        ))}
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
