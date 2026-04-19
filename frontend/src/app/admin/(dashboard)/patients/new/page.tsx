"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchAPI } from "@/lib/api";

type FormState = {
  name: string;
  national_id: string;
  sex: "M" | "F" | "O";
  birth_date: string;
  phone: string;
  address: string;
  email: string;
};

const INIT: FormState = {
  name: "",
  national_id: "",
  sex: "M",
  birth_date: "",
  phone: "",
  address: "",
  email: "",
};

export default function NewPatientPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INIT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Partial<FormState> = { ...form };
      if (!body.email) delete body.email;  // 可選欄位空字串 → 不送
      await fetchAPI("/patients", {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.push("/admin/patients");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <a href="/admin/patients" className="text-sm text-gray-500 hover:underline">
          ← 回到病患列表
        </a>
        <h1 className="text-xl font-bold mt-1">新增病患</h1>
      </div>

      <form onSubmit={submit} className="bg-white rounded-lg shadow-sm p-4 space-y-3 max-w-lg">
        <Field label="姓名 *" required>
          <input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
            maxLength={20}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="身分證字號 * (格式：A123456789)" required>
          <input
            value={form.national_id}
            onChange={(e) => update("national_id", e.target.value.toUpperCase())}
            required
            pattern="^[A-Z][12]\d{8}$"
            maxLength={10}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
          />
        </Field>

        <Field label="性別 *" required>
          <select
            value={form.sex}
            onChange={(e) => update("sex", e.target.value as FormState["sex"])}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="M">男</option>
            <option value="F">女</option>
            <option value="O">其他</option>
          </select>
        </Field>

        <Field label="生日 *" required>
          <input
            type="date"
            value={form.birth_date}
            onChange={(e) => update("birth_date", e.target.value)}
            required
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="電話 *" required>
          <input
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            required
            maxLength={20}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="地址 *" required>
          <input
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            required
            maxLength={200}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Email（可選）">
          <input
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            maxLength={100}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        {error && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>}

        <div className="flex gap-2 pt-2 border-t">
          <button
            type="submit"
            disabled={submitting}
            className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? "建立中…" : "建立"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/patients")}
            className="px-6 py-2 border rounded hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required: _required,  // accepted for compile but styling only
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm mb-1">{label}</label>
      {children}
    </div>
  );
}
