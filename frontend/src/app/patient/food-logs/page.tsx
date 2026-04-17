"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

interface FoodLogEntry {
  id: number;
  logged_at: string;
  meal_type: string | null;
  image_url: string | null;
  food_items: { name: string; portion: string }[] | null;
  total_calories: number | null;
  total_protein: number | null;
  total_carbs: number | null;
  total_fat: number | null;
  ai_suggestion: string | null;
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "點心",
};

export default function FoodLogsPage() {
  const [logs, setLogs] = useState<FoodLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAPI<FoodLogEntry[]>("/food-logs")
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center py-8">載入中...</p>;

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>尚無飲食記錄</p>
        <p className="text-sm mt-2">透過 LINE 傳送食物照片即可記錄</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">飲食記錄</h1>
      <div className="space-y-3">
        {logs.map((log) => (
          <div key={log.id} className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">
                {log.meal_type ? MEAL_LABELS[log.meal_type] || log.meal_type : "未分類"}
              </span>
              <span className="text-sm text-gray-500">
                {new Date(log.logged_at).toLocaleDateString("zh-TW")}
              </span>
            </div>
            {log.food_items && (
              <div className="text-sm text-gray-700 mb-2">
                {log.food_items.map((item, i) => (
                  <span key={i}>
                    {item.name}
                    {i < log.food_items!.length - 1 ? "、" : ""}
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-4 gap-1 text-center text-xs">
              <div>
                <div className="font-bold">{log.total_calories ?? "-"}</div>
                <div className="text-gray-500">卡路里</div>
              </div>
              <div>
                <div className="font-bold">{log.total_protein ?? "-"}</div>
                <div className="text-gray-500">蛋白質 g</div>
              </div>
              <div>
                <div className="font-bold">{log.total_carbs ?? "-"}</div>
                <div className="text-gray-500">碳水 g</div>
              </div>
              <div>
                <div className="font-bold">{log.total_fat ?? "-"}</div>
                <div className="text-gray-500">脂肪 g</div>
              </div>
            </div>
            {log.ai_suggestion && (
              <div className="mt-2 text-sm text-blue-700 bg-blue-50 rounded p-2">
                {log.ai_suggestion}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
