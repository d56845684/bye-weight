"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetchAPI } from "@/lib/api";

// 台灣身分證：首碼 A-Z，次碼 1 (男) / 2 (女)，後接 8 位數字
const NATIONAL_ID_RE = /^[A-Z][12]\d{8}$/;

type FormState = {
  name: string;
  national_id: string;
  sex: "M" | "F" | "O";
  birth_date: string;
  phone: string;
  address: string;
};

const INITIAL: FormState = {
  name: "",
  national_id: "",
  sex: "M",
  birth_date: "",
  phone: "",
  address: "",
};

export default function PatientRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const nid = form.national_id.trim().toUpperCase();
    if (!NATIONAL_ID_RE.test(nid)) {
      setError("身分證格式錯誤（應為 1 個英文字母 + 9 碼數字，第 2 碼為 1 或 2）");
      return;
    }
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim() || !form.birth_date) {
      setError("請完整填寫所有欄位");
      return;
    }

    setSubmitting(true);
    try {
      await fetchAPI("/patients/register", {
        method: "POST",
        body: JSON.stringify({ ...form, national_id: nid }),
      });
      // 綁定完成判定：LINE 綁好 + patient profile 建起來，到這裡才真的「完成」。
      // 顯示 1.2 秒完成畫面讓使用者有明確感知，再導到主頁。
      setDone(true);
      setTimeout(() => router.replace("/patient/food-logs"), 1200);
      return;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("資料已存在（身分證可能已被登記，或你已完成註冊）");
      } else if (e instanceof ApiError && e.status === 400) {
        setError("欄位驗證未通過，請檢查格式");
      } else if (e instanceof ApiError && e.status === 0) {
        setError(`無法連線到伺服器：${e.message}`);
      } else if (e instanceof ApiError) {
        setError(`HTTP ${e.status} — ${e.message}`);
      } else {
        setError((e as Error).message || "註冊失敗");
      }
      // 保留原始物件方便在 console 看 stack
      console.error("[register submit]", e);
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl mb-4">
          ✓
        </div>
        <h1 className="text-xl font-bold mb-1">綁定完成</h1>
        <p className="text-sm text-gray-500">已建立病患資料，正在前往首頁…</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-2">建立病患資料</h1>
      <p className="text-sm text-gray-500 mb-4">
        首次登入需要建立資料才能查看後續紀錄。
      </p>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded text-sm mb-3">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-3 bg-white rounded-lg shadow-sm p-4">
        <label className="block">
          <span className="text-sm font-medium">中文姓名</span>
          <input
            required
            maxLength={20}
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">身分證字號</span>
          <input
            required
            maxLength={10}
            value={form.national_id}
            onChange={(e) => update("national_id", e.target.value.toUpperCase())}
            placeholder="A123456789"
            className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono uppercase"
          />
        </label>

        <div>
          <span className="text-sm font-medium">性別</span>
          <div className="mt-1 flex gap-4 text-sm">
            {(["M", "F", "O"] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="sex"
                  checked={form.sex === opt}
                  onChange={() => update("sex", opt)}
                />
                {opt === "M" ? "男" : opt === "F" ? "女" : "其他"}
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium">生日</span>
          <input
            type="date"
            required
            value={form.birth_date}
            onChange={(e) => update("birth_date", e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">電話</span>
          <input
            required
            maxLength={20}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="0912345678"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">地址</span>
          <input
            required
            maxLength={200}
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "送出中…" : "送出"}
        </button>
      </form>
    </div>
  );
}
