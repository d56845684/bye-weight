"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
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

type BindingResult = {
  user_id: number;
  binding_token: string;
  binding_url: string;
  expires_at: string;
};

export default function NewPatientPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INIT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binding, setBinding] = useState<BindingResult | null>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const buildBody = () => {
    const body: Partial<FormState> = { ...form };
    if (!body.email) delete body.email;
    return body;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fetchAPI("/patients", {
        method: "POST",
        body: JSON.stringify(buildBody()),
      });
      router.push("/admin/patients");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 「建立並產生邀請連結」：兩段式
  // 1) /auth/v1/admin/users/invite → 建 role=patient 的 auth user + binding token
  // 2) /api/v1/patients （帶 auth_user_id）→ 建 patient profile
  // 失敗情境：step 2 失敗時 auth user 已存在，病患可在 LIFF 綁定後走 /patient/register 自己填表。
  const submitAndInvite = async () => {
    if (!form.name.trim()) {
      setError("姓名為必填");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // step 1
      const inviteRes = await fetch("/auth/v1/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ display_name: form.name }),
      });
      if (!inviteRes.ok) {
        const msg = await inviteRes.text();
        if (inviteRes.status === 403) {
          throw new Error("無權產生邀請連結（需要 admin:user:invite 權限）");
        }
        throw new Error(msg);
      }
      const invite: BindingResult & { user_id: number } = await inviteRes.json();

      // step 2
      try {
        await fetchAPI("/patients", {
          method: "POST",
          body: JSON.stringify({ ...buildBody(), auth_user_id: invite.user_id }),
        });
      } catch (e: any) {
        setError(`Auth user 建立成功但 patient profile 建立失敗：${e.message}。病患綁定後可自行在 /patient/register 填表。`);
      }
      setBinding(invite);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const absoluteURL = (u: string) =>
    u.startsWith("http") ? u : `${window.location.origin}${u}`;

  return (
    <div>
      <div className="mb-4">
        <a href="/admin/patients" className="text-sm text-gray-500 hover:underline">
          ← 回到病患列表
        </a>
        <h1 className="text-xl font-bold mt-1">新增病患</h1>
      </div>

      <form onSubmit={submit} className="bg-white rounded-lg shadow-sm p-4 space-y-3 max-w-lg">
        <Field label="姓名 *">
          <input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
            maxLength={20}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="身分證字號 * (格式：A123456789)">
          <input
            value={form.national_id}
            onChange={(e) => update("national_id", e.target.value.toUpperCase())}
            required
            pattern="^[A-Z][12]\d{8}$"
            maxLength={10}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
          />
        </Field>

        <Field label="性別 *">
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

        <Field label="生日 *">
          <input
            type="date"
            value={form.birth_date}
            onChange={(e) => update("birth_date", e.target.value)}
            required
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="電話 *">
          <input
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            required
            maxLength={20}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="地址 *">
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
            className="px-6 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
            title="只建立病患 profile，不綁 LINE"
          >
            {submitting ? "處理中…" : "僅建立"}
          </button>
          <button
            type="button"
            onClick={submitAndInvite}
            disabled={submitting}
            className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
            title="建立病患並產生 LINE 綁定連結"
          >
            {submitting ? "處理中…" : "建立並產生邀請連結"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/patients")}
            className="ml-auto px-6 py-2 border rounded hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </form>

      {binding && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold">邀請連結已產生</h2>
            <p className="text-sm text-gray-600">
              把此連結或 QR 碼傳給病患，7 天內用 LINE 打開即可綁定。
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
                onClick={() => router.push("/admin/patients")}
                className="flex-1 bg-red-700 text-white rounded py-2 text-sm hover:bg-red-800"
              >
                返回列表
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm mb-1">{label}</label>
      {children}
    </div>
  );
}
