"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchAPI } from "@/lib/api";

type Candidate = {
  id: number;
  name: string;
  chart_no: string | null;
  birth_date: string | null;
};

type PendingItem = {
  id: number;
  status: "ambiguous" | "unmatched" | "ocr_failed" | "pending" | string;
  uploaded_at: string;
  uploaded_by: number | null;
  image_url: string | null;
  ocr_name: string | null;
  ocr_birth_date: string | null;
  ocr_chart_no: string | null;
  ocr_data: Record<string, unknown> | null;
  candidates: Candidate[];
};

type SearchHit = {
  id: number;
  name: string;
  chart_no: string | null;
  birth_date: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  ambiguous: "同名多筆",
  unmatched: "查無此人",
  ocr_failed: "OCR 失敗",
  pending: "未處理",
};

const STATUS_COLOR: Record<string, string> = {
  ambiguous: "bg-yellow-100 text-yellow-800",
  unmatched: "bg-orange-100 text-orange-800",
  ocr_failed: "bg-red-100 text-red-800",
  pending: "bg-gray-100 text-gray-700",
};

export default function InbodyPendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI<PendingItem[]>("/inbody/pending");
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolveTo = async (pendingId: number, patientId: number) => {
    try {
      await fetchAPI(`/inbody/pending/${pendingId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ patient_id: patientId }),
      });
      await load();
    } catch (e) {
      alert(`指派失敗：${e instanceof Error ? e.message : e}`);
    }
  };

  const discard = async (pendingId: number) => {
    if (!confirm("確定丟棄此筆 pending？（不可還原）")) return;
    try {
      await fetchAPI(`/inbody/pending/${pendingId}/discard`, { method: "POST" });
      await load();
    } catch (e) {
      alert(`丟棄失敗：${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div>
      <div className="flex items-center mb-4 gap-3">
        <h1 className="text-xl font-bold">InBody 待確認</h1>
        <span className="text-xs text-gray-500">
          OCR 後無法自動歸屬的照片，需人工確認歸屬病患
        </span>
        <button
          onClick={load}
          className="ml-auto text-sm px-3 py-1 border rounded hover:bg-gray-100"
        >
          重新整理
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-3">錯誤：{error}</div>}
      {loading && <div className="text-gray-500">載入中…</div>}

      {!loading && !error && items.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-400">
          目前沒有待確認的項目 🎉
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3 w-20">狀態</th>
                <th className="p-3">上傳時間</th>
                <th className="p-3">OCR 姓名</th>
                <th className="p-3">生日</th>
                <th className="p-3">病歷號</th>
                <th className="p-3 w-36 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <Row
                  key={it.id}
                  item={it}
                  open={openId === it.id}
                  onToggle={() => setOpenId(openId === it.id ? null : it.id)}
                  onResolve={(pid) => resolveTo(it.id, pid)}
                  onDiscard={() => discard(it.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  open,
  onToggle,
  onResolve,
  onDiscard,
}: {
  item: PendingItem;
  open: boolean;
  onToggle: () => void;
  onResolve: (patientId: number) => void;
  onDiscard: () => void;
}) {
  const statusLabel = STATUS_LABEL[item.status] ?? item.status;
  const statusColor = STATUS_COLOR[item.status] ?? "bg-gray-100 text-gray-700";

  return (
    <>
      <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="p-3">
          <span className={`text-xs px-2 py-1 rounded ${statusColor}`}>{statusLabel}</span>
        </td>
        <td className="p-3">{new Date(item.uploaded_at).toLocaleString("zh-TW")}</td>
        <td className="p-3">{item.ocr_name ?? "—"}</td>
        <td className="p-3">{item.ocr_birth_date ?? "—"}</td>
        <td className="p-3 font-mono text-xs">{item.ocr_chart_no ?? "—"}</td>
        <td className="p-3 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            className="text-xs text-gray-500 hover:text-red-700 hover:underline mr-3"
          >
            丟棄
          </button>
          <button
            onClick={onToggle}
            className="text-xs text-red-700 hover:underline"
          >
            {open ? "收合" : "指派"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t bg-gray-50">
          <td colSpan={6} className="p-4">
            <ExpandPanel item={item} onResolve={onResolve} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandPanel({
  item,
  onResolve,
}: {
  item: PendingItem;
  onResolve: (patientId: number) => void;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">OCR 內容</h3>
        <pre className="bg-white border rounded p-3 text-xs overflow-x-auto max-h-64">
{JSON.stringify(item.ocr_data ?? {}, null, 2)}
        </pre>
        {item.image_url && (
          <div className="mt-2 text-xs">
            <a
              href={item.image_url}
              target="_blank"
              rel="noreferrer"
              className="text-red-700 hover:underline"
            >
              看原始圖片 ↗
            </a>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">指派到病患</h3>
        {item.status === "ocr_failed" ? (
          <p className="text-xs text-red-700">
            OCR 失敗沒有資料可寫，請直接「丟棄」。若需要重新辨識請重新上傳原圖。
          </p>
        ) : (
          <AssignPicker
            initialCandidates={item.candidates}
            onPick={onResolve}
          />
        )}
      </div>
    </div>
  );
}

function AssignPicker({
  initialCandidates,
  onPick,
}: {
  initialCandidates: Candidate[];
  onPick: (patientId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const data = await fetchAPI<{ patients: SearchHit[] }>(
        `/patients?q=${encodeURIComponent(query.trim())}`,
      );
      setHits(data.patients ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setSearchErr("沒有搜尋病患的權限");
      } else {
        setSearchErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-3">
      {initialCandidates.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">系統偵測同名候選</div>
          <ul className="space-y-1">
            {initialCandidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between bg-white border rounded px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{c.name}</span>
                  {c.chart_no && <span className="ml-2 text-xs font-mono text-gray-500">{c.chart_no}</span>}
                  {c.birth_date && <span className="ml-2 text-xs text-gray-500">{c.birth_date}</span>}
                </span>
                <button
                  onClick={() => onPick(c.id)}
                  className="text-xs bg-red-700 text-white rounded px-3 py-1 hover:bg-red-800"
                >
                  指派給此人
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-xs text-gray-500 mb-1">搜尋其他病患</div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="輸入姓名…"
            className="flex-1 border rounded px-3 py-1 text-sm"
          />
          <button
            onClick={runSearch}
            disabled={searching}
            className="text-sm px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50"
          >
            {searching ? "搜尋中…" : "搜尋"}
          </button>
        </div>
        {searchErr && <div className="text-xs text-red-700 mt-1">{searchErr}</div>}
        {hits.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {hits.map((h) => (
              <li key={h.id} className="flex items-center justify-between bg-white border rounded px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{h.name}</span>
                  {h.chart_no && <span className="ml-2 text-xs font-mono text-gray-500">{h.chart_no}</span>}
                  {h.birth_date && <span className="ml-2 text-xs text-gray-500">{h.birth_date}</span>}
                </span>
                <button
                  onClick={() => onPick(h.id)}
                  className="text-xs border border-red-700 text-red-700 rounded px-3 py-1 hover:bg-red-50"
                >
                  指派
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
