"use client";

import { useState } from "react";
import { fetchAPI } from "@/lib/api";

export default function ManualPushPage() {
  const [lineUuid, setLineUuid] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSend = async () => {
    if (!lineUuid || !message) return;
    setSending(true);
    setResult(null);

    try {
      await fetchAPI("/notify/manual", {
        method: "POST",
        body: JSON.stringify({ line_uuid: lineUuid, message }),
      });
      setResult("發送成功");
      setMessage("");
    } catch (err) {
      setResult(`發送失敗: ${err}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">手動推播</h1>
      <div className="bg-white rounded-lg p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            病患 LINE UUID
          </label>
          <input
            type="text"
            value={lineUuid}
            onChange={(e) => setLineUuid(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Uxxxxxxxxxxxxxxxxxx"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            訊息內容
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="輸入要推播的訊息..."
          />
        </div>
        <button
          onClick={handleSend}
          disabled={sending || !lineUuid || !message}
          className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {sending ? "發送中..." : "發送推播"}
        </button>
        {result && (
          <p className="text-sm text-center text-gray-600">{result}</p>
        )}
      </div>
    </div>
  );
}
