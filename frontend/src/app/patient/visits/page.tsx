"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

interface VisitEntry {
  id: number;
  visit_date: string;
  doctor_id: string | null;
  notes: string | null;
  next_visit_date: string | null;
}

export default function VisitsPage() {
  const [visits, setVisits] = useState<VisitEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAPI<VisitEntry[]>("/visits")
      .then(setVisits)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center py-8">載入中...</p>;

  if (visits.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>尚無看診紀錄</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">看診紀錄</h1>
      <div className="space-y-3">
        {visits.map((v) => (
          <div key={v.id} className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="font-medium">
                {new Date(v.visit_date).toLocaleDateString("zh-TW")}
              </span>
              {v.next_visit_date && (
                <span className="text-sm text-blue-600">
                  下次回診: {new Date(v.next_visit_date).toLocaleDateString("zh-TW")}
                </span>
              )}
            </div>
            {v.notes && (
              <p className="text-sm text-gray-600 mt-2">{v.notes}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
