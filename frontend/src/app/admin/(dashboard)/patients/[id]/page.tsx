"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

type Patient = {
  id: number;
  auth_user_id: number | null;
  tenant_id: number;
  name: string;
  sex: "M" | "F" | "O" | null;
  birth_date: string;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
};

export default function PatientEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [p, setP] = useState<Patient | null>(null);
  const [initial, setInitial] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchAPI<Patient>(`/patients/${id}`);
        setP(data);
        setInitial(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="text-gray-500">載入中…</div>;
  if (!p) return <div className="bg-red-50 text-red-700 p-3 rounded">錯誤：{error ?? "找不到病患"}</div>;

  const update = <K extends keyof Patient>(k: K, v: Patient[K]) =>
    setP({ ...p, [k]: v });

  const dirty = initial !== null && JSON.stringify(initial) !== JSON.stringify(p);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: p.name,
        sex: p.sex,
        birth_date: p.birth_date,
        phone: p.phone,
        address: p.address,
        email: p.email,
      };
      await fetchAPI(`/patients/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setInitial({ ...p });
      alert("已儲存");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const softDelete = async () => {
    if (!confirm(`軟刪除「${p.name}」？資料保留在 DB。`)) return;
    try {
      const res = await fetch(`/api/v1/patients/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/admin/patients");
    } catch (e: any) {
      alert(`刪除失敗：${e.message}`);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <a href="/admin/patients" className="text-sm text-gray-500 hover:underline">
          ← 回到病患列表
        </a>
        <h1 className="text-xl font-bold mt-1">
          編輯病患：<span className="text-red-700">{initial?.name}</span>
          <span className="ml-2 text-sm text-gray-500">#{p.id}</span>
        </h1>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3 max-w-lg">
        <Field label="姓名">
          <input
            value={p.name}
            onChange={(e) => update("name", e.target.value)}
            maxLength={20}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="身分證字號（不可修改）">
          <input
            value={p.national_id ?? ""}
            readOnly
            className="w-full border rounded px-3 py-2 text-sm bg-gray-50 font-mono"
          />
        </Field>

        <Field label="性別">
          <select
            value={p.sex ?? "M"}
            onChange={(e) => update("sex", e.target.value as Patient["sex"])}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="M">男</option>
            <option value="F">女</option>
            <option value="O">其他</option>
          </select>
        </Field>

        <Field label="生日">
          <input
            type="date"
            value={p.birth_date}
            onChange={(e) => update("birth_date", e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="電話">
          <input
            value={p.phone ?? ""}
            onChange={(e) => update("phone", e.target.value)}
            maxLength={20}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="地址">
          <input
            value={p.address ?? ""}
            onChange={(e) => update("address", e.target.value)}
            maxLength={200}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Email">
          <input
            type="email"
            value={p.email ?? ""}
            onChange={(e) => update("email", e.target.value)}
            maxLength={100}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <div className="pt-2 border-t text-xs text-gray-500">
          <div>auth_user_id（LINE 綁定）：{p.auth_user_id ?? "未綁"}</div>
          <div>tenant_id：{p.tenant_id}</div>
        </div>

        {error && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
          <button
            onClick={softDelete}
            className="px-6 py-2 border border-red-400 text-red-700 rounded hover:bg-red-50"
          >
            刪除
          </button>
          <button
            onClick={() => router.push("/admin/patients")}
            className="ml-auto px-6 py-2 border rounded hover:bg-gray-50"
          >
            返回
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm mb-1">{label}</label>
      {children}
    </div>
  );
}
