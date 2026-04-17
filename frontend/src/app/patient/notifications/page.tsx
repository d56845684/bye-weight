"use client";

import { useEffect, useState } from "react";
import { fetchAPI } from "@/lib/api";

interface NotifRule {
  id: number;
  type: string;
  days_before: number | null;
  interval_days: number | null;
  send_time: string | null;
  active: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  revisit: "回診提醒",
  inbody: "InBody 測量提醒",
};

export default function NotificationsPage() {
  const [rules, setRules] = useState<NotifRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAPI<NotifRule[]>("/notification-rules")
      .then(setRules)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleRule = async (ruleId: number, currentActive: boolean) => {
    await fetchAPI(`/notification-rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !currentActive }),
    });
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, active: !currentActive } : r))
    );
  };

  if (loading) return <p className="text-center py-8">載入中...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">通知設定</h1>
      {rules.length === 0 ? (
        <p className="text-center text-gray-500 py-8">尚無通知規則</p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-white rounded-lg p-4 shadow-sm flex justify-between items-center"
            >
              <div>
                <div className="font-medium">
                  {TYPE_LABELS[rule.type] || rule.type}
                </div>
                <div className="text-sm text-gray-500">
                  {rule.type === "revisit"
                    ? `回診前 ${rule.days_before} 天提醒`
                    : `每 ${rule.interval_days} 天提醒`}
                </div>
              </div>
              <button
                onClick={() => toggleRule(rule.id, rule.active)}
                className={`px-3 py-1 rounded-full text-sm ${
                  rule.active
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {rule.active ? "已啟用" : "已停用"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
