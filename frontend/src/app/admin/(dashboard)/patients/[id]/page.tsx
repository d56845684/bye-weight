"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

// Admin 單一病患 detail 頁：5 tab（基本資料 / InBody / 飲食 / 看診 / 目標），
// 資料靠 GET /patients/{id}/detail aggregator 一次抓完，不切多支 endpoint。

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
  chart_no: string | null;
  his_id: string | null;
};

type Segmental = { la?: number; ra?: number; tr?: number; ll?: number; rl?: number };

type InbodyRow = {
  id: number; measured_at: string;
  weight: number | null; bmi: number | null; body_fat_pct: number | null;
  muscle_mass: number | null; visceral_fat: number | null; metabolic_rate: number | null;
  body_age: number | null;
  total_body_water: number | null; protein_mass: number | null; mineral_mass: number | null;
  muscle_segmental: Segmental | null; fat_segmental: Segmental | null;
  match_status: string | null;
};

type FoodRow = {
  id: number; logged_at: string; meal_type: string | null;
  food_items: { name: string; portion?: string }[] | null;
  total_calories: number | null; total_protein: number | null;
  total_carbs: number | null; total_fat: number | null;
  ai_suggestion: string | null;
};

type VisitRow = {
  id: number; visit_date: string; next_visit_date: string | null;
  doctor_id: string | null; notes: string | null;
  upcoming: boolean; days_away: number | null;
};

type GoalRow = {
  id: number; effective_from: string;
  daily_kcal: number | null; target_weight: number | null; target_body_fat: number | null;
  target_carbs_pct: number | null; target_protein_pct: number | null; target_fat_pct: number | null;
  set_by: number | null; notes: string | null; created_at: string;
};

type Detail = {
  patient: Patient;
  goals: GoalRow[];
  inbody_records: InbodyRow[];
  food_logs: FoodRow[];
  visits: VisitRow[];
};

type Tab = "basic" | "inbody" | "food" | "visits" | "goals";

const MEAL_LABEL: Record<string, string> = {
  breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "點心",
};

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("basic");

  // local edit state — 基本資料 tab 用
  const [p, setP] = useState<Patient | null>(null);
  const [initial, setInitial] = useState<Patient | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const d = await fetchAPI<Detail>(`/patients/${id}/detail?food_log_days=30`);
      setData(d);
      setP(d.patient);
      setInitial(d.patient);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [id]);

  if (loading) return <div className="text-gray-500">載入中…</div>;
  if (!data || !p) return <div className="bg-red-50 text-red-700 p-3 rounded">錯誤：{error ?? "找不到病患"}</div>;

  const update = <K extends keyof Patient>(k: K, v: Patient[K]) => setP({ ...p, [k]: v });
  const dirty = initial !== null && JSON.stringify(initial) !== JSON.stringify(p);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchAPI(`/patients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: p.name, sex: p.sex, birth_date: p.birth_date,
          phone: p.phone, address: p.address, email: p.email,
          chart_no: p.chart_no, his_id: p.his_id,
        }),
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
      const res = await fetch(`/api/v1/patients/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      router.push("/admin/patients");
    } catch (e: any) {
      alert(`刪除失敗：${e.message}`);
    }
  };

  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: "basic",  label: "基本資料" },
    { k: "inbody", label: "InBody",  n: data.inbody_records.length },
    { k: "food",   label: "飲食",    n: data.food_logs.length },
    { k: "visits", label: "看診",    n: data.visits.length },
    { k: "goals",  label: "目標",    n: data.goals.length },
  ];

  return (
    <div>
      <div className="mb-4">
        <a href="/admin/patients" className="text-sm text-gray-500 hover:underline">← 回到病患列表</a>
        <h1 className="text-xl font-bold mt-1">
          <span className="text-red-700">{initial?.name}</span>
          <span className="ml-2 text-sm text-gray-500 font-normal">#{p.id} · {p.chart_no ?? "—"}</span>
        </h1>
      </div>

      <div className="flex gap-1 border-b mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.k ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.n !== undefined && <span className="ml-1.5 text-xs text-gray-400">({t.n})</span>}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <BasicTab
          p={p} update={update} dirty={dirty} save={save} saving={saving}
          error={error} onDelete={softDelete}
        />
      )}
      {tab === "inbody" && <InbodyTab rows={data.inbody_records} />}
      {tab === "food"   && <FoodTab rows={data.food_logs} />}
      {tab === "visits" && <VisitsTab rows={data.visits} />}
      {tab === "goals"  && <GoalsTab rows={data.goals} />}
    </div>
  );
}

function BasicTab({
  p, update, dirty, save, saving, error, onDelete,
}: {
  p: Patient;
  update: <K extends keyof Patient>(k: K, v: Patient[K]) => void;
  dirty: boolean; save: () => Promise<void>; saving: boolean;
  error: string | null; onDelete: () => Promise<void>;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 space-y-3 max-w-lg">
      <Field label="姓名">
        <input value={p.name} onChange={(e) => update("name", e.target.value)}
               maxLength={20} className="w-full border rounded px-3 py-2 text-sm" />
      </Field>
      <Field label="身分證字號（不可修改）">
        <input value={p.national_id ?? ""} readOnly
               className="w-full border rounded px-3 py-2 text-sm bg-gray-50 font-mono" />
      </Field>
      <Field label="性別">
        <select value={p.sex ?? "M"} onChange={(e) => update("sex", e.target.value as Patient["sex"])}
                className="w-full border rounded px-3 py-2 text-sm">
          <option value="M">男</option>
          <option value="F">女</option>
          <option value="O">其他</option>
        </select>
      </Field>
      <Field label="生日">
        <input type="date" value={p.birth_date} onChange={(e) => update("birth_date", e.target.value)}
               className="w-full border rounded px-3 py-2 text-sm" />
      </Field>
      <Field label="電話">
        <input value={p.phone ?? ""} onChange={(e) => update("phone", e.target.value)}
               maxLength={20} className="w-full border rounded px-3 py-2 text-sm" />
      </Field>
      <Field label="地址">
        <input value={p.address ?? ""} onChange={(e) => update("address", e.target.value)}
               maxLength={200} className="w-full border rounded px-3 py-2 text-sm" />
      </Field>
      <Field label="Email">
        <input type="email" value={p.email ?? ""} onChange={(e) => update("email", e.target.value)}
               maxLength={100} className="w-full border rounded px-3 py-2 text-sm" />
      </Field>
      <Field label="病歷號（同診所不可重複；InBody OCR 自動比對用）">
        <input value={p.chart_no ?? ""} onChange={(e) => update("chart_no", e.target.value || null)}
               maxLength={20} className="w-full border rounded px-3 py-2 text-sm font-mono" />
      </Field>
      <Field label="HIS ID（健保 / 醫院系統外部主鍵）">
        <input value={p.his_id ?? ""} onChange={(e) => update("his_id", e.target.value || null)}
               maxLength={20} className="w-full border rounded px-3 py-2 text-sm font-mono" />
      </Field>
      <div className="pt-2 border-t text-xs text-gray-500">
        <div>auth_user_id（LINE 綁定）：{p.auth_user_id ?? "未綁"}</div>
        <div>tenant_id：{p.tenant_id}</div>
      </div>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>}
      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={saving || !dirty}
                className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50">
          {saving ? "儲存中…" : "儲存"}
        </button>
        <button onClick={onDelete}
                className="px-6 py-2 border border-red-400 text-red-700 rounded hover:bg-red-50">
          刪除
        </button>
      </div>
    </div>
  );
}

function InbodyTab({ rows }: { rows: InbodyRow[] }) {
  if (rows.length === 0) return <Empty label="尚無 InBody 紀錄" />;
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-left">
          <tr>
            <th className="p-3">測量時間</th>
            <th className="p-3 text-right">體重</th>
            <th className="p-3 text-right">BMI</th>
            <th className="p-3 text-right">體脂%</th>
            <th className="p-3 text-right">肌肉</th>
            <th className="p-3 text-right">內臟</th>
            <th className="p-3 text-right">基代</th>
            <th className="p-3 text-right">體齡</th>
            <th className="p-3 text-right">水分</th>
            <th className="p-3 text-right">蛋白</th>
            <th className="p-3 text-right">礦物</th>
            <th className="p-3">來源</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="p-3 whitespace-nowrap">{new Date(r.measured_at).toLocaleString("zh-TW")}</td>
              <td className="p-3 text-right font-mono">{fmt(r.weight)}</td>
              <td className="p-3 text-right font-mono">{fmt(r.bmi)}</td>
              <td className="p-3 text-right font-mono">{fmt(r.body_fat_pct)}</td>
              <td className="p-3 text-right font-mono">{fmt(r.muscle_mass)}</td>
              <td className="p-3 text-right font-mono">{r.visceral_fat ?? "—"}</td>
              <td className="p-3 text-right font-mono">{fmt(r.metabolic_rate, 0)}</td>
              <td className="p-3 text-right font-mono">{r.body_age ?? "—"}</td>
              <td className="p-3 text-right font-mono">{fmt(r.total_body_water)}</td>
              <td className="p-3 text-right font-mono">{fmt(r.protein_mass)}</td>
              <td className="p-3 text-right font-mono">{fmt(r.mineral_mass)}</td>
              <td className="p-3">
                <span className="text-xs text-gray-500">{r.match_status ?? "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FoodTab({ rows }: { rows: FoodRow[] }) {
  if (rows.length === 0) return <Empty label="尚無飲食紀錄" />;

  // 依日期分群，最新的日子在最上面
  const byDate: Record<string, FoodRow[]> = {};
  for (const r of rows) {
    const d = r.logged_at.slice(0, 10);
    (byDate[d] ||= []).push(r);
  }
  const dates = Object.keys(byDate).sort().reverse();

  return (
    <div className="space-y-4">
      {dates.map((d) => {
        const day = byDate[d];
        const total = day.reduce((s, r) => s + (r.total_calories || 0), 0);
        return (
          <div key={d} className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 flex items-center justify-between border-b">
              <span className="text-sm font-semibold">{d}</span>
              <span className="text-xs text-gray-500 font-mono">
                {day.length} 餐 · 共 {Math.round(total)} kcal
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="p-2.5 pl-4">時間</th>
                  <th className="p-2.5">餐</th>
                  <th className="p-2.5">內容</th>
                  <th className="p-2.5 text-right">kcal</th>
                  <th className="p-2.5 text-right">C / P / F (g)</th>
                </tr>
              </thead>
              <tbody>
                {day.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-2.5 pl-4 font-mono text-xs whitespace-nowrap">
                      {new Date(r.logged_at).toLocaleTimeString("zh-TW", {
                        hour: "2-digit", minute: "2-digit", hour12: false,
                      })}
                    </td>
                    <td className="p-2.5">{MEAL_LABEL[r.meal_type ?? ""] ?? r.meal_type ?? "—"}</td>
                    <td className="p-2.5 text-xs text-gray-700">
                      {r.food_items?.map((i) => i.name).join("、") ?? "—"}
                      {r.ai_suggestion && (
                        <div className="mt-1 text-[11px] text-teal-700 bg-teal-50 rounded px-2 py-1">
                          {r.ai_suggestion}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 text-right font-mono">{fmt(r.total_calories, 0)}</td>
                    <td className="p-2.5 text-right font-mono text-xs text-gray-500">
                      {fmt(r.total_carbs, 0)} / {fmt(r.total_protein, 0)} / {fmt(r.total_fat, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function VisitsTab({ rows }: { rows: VisitRow[] }) {
  if (rows.length === 0) return <Empty label="尚無看診紀錄" />;
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-left">
          <tr>
            <th className="p-3">日期</th>
            <th className="p-3">醫師</th>
            <th className="p-3">備註</th>
            <th className="p-3">下次回診</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="p-3 whitespace-nowrap font-mono">{r.visit_date}</td>
              <td className="p-3">{r.doctor_id ?? "—"}</td>
              <td className="p-3 text-gray-700 leading-relaxed">{r.notes ?? "—"}</td>
              <td className="p-3 whitespace-nowrap font-mono">
                {r.next_visit_date ?? "—"}
                {r.upcoming && (
                  <span className="ml-1.5 text-[10px] bg-teal-600 text-white px-1.5 py-0.5 rounded">
                    剩 {r.days_away} 天
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoalsTab({ rows }: { rows: GoalRow[] }) {
  if (rows.length === 0) return <Empty label="尚未設定目標" />;
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-left">
          <tr>
            <th className="p-3">生效日</th>
            <th className="p-3 text-right">每日熱量</th>
            <th className="p-3 text-right">目標體重</th>
            <th className="p-3 text-right">目標體脂</th>
            <th className="p-3 text-right">C / P / F %</th>
            <th className="p-3">備註</th>
            <th className="p-3">設定者</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={`border-t align-top ${i === 0 ? "bg-teal-50" : ""}`}>
              <td className="p-3 whitespace-nowrap font-mono">
                {r.effective_from}
                {i === 0 && <span className="ml-1.5 text-[10px] bg-teal-600 text-white px-1.5 py-0.5 rounded">當前</span>}
              </td>
              <td className="p-3 text-right font-mono">{r.daily_kcal ?? "—"}</td>
              <td className="p-3 text-right font-mono">{fmt(r.target_weight)}</td>
              <td className="p-3 text-right font-mono">{fmt(r.target_body_fat)}</td>
              <td className="p-3 text-right font-mono text-xs">
                {fmt(r.target_carbs_pct, 0)} / {fmt(r.target_protein_pct, 0)} / {fmt(r.target_fat_pct, 0)}
              </td>
              <td className="p-3 text-xs text-gray-700">{r.notes ?? "—"}</td>
              <td className="p-3 text-xs text-gray-500">{r.set_by ? `#${r.set_by}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-8 text-center text-sm text-gray-400">
      {label}
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

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) && decimals === 0 ? String(v) : v.toFixed(decimals);
}
