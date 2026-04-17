"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

interface InbodyRecord {
  id: number;
  measured_at: string;
  weight: number | null;
  bmi: number | null;
  body_fat_pct: number | null;
  muscle_mass: number | null;
  visceral_fat: number | null;
  metabolic_rate: number | null;
}

export default function InbodyPage() {
  const [records, setRecords] = useState<InbodyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAPI<InbodyRecord[]>("/inbody/history")
      .then(setRecords)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center py-8">載入中...</p>;

  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>尚無 InBody 紀錄</p>
        <p className="text-sm mt-2">請至診所測量 InBody</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">身體組成趨勢</h1>
      <div className="space-y-3">
        {records.map((r) => (
          <div key={r.id} className="bg-white rounded-lg p-4 shadow-sm">
            <div className="text-sm text-gray-500 mb-2">
              {new Date(r.measured_at).toLocaleDateString("zh-TW")}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold">{r.weight ?? "-"}</div>
                <div className="text-xs text-gray-500">體重 kg</div>
              </div>
              <div>
                <div className="text-lg font-bold">{r.body_fat_pct ?? "-"}</div>
                <div className="text-xs text-gray-500">體脂率 %</div>
              </div>
              <div>
                <div className="text-lg font-bold">{r.muscle_mass ?? "-"}</div>
                <div className="text-xs text-gray-500">肌肉量 kg</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
