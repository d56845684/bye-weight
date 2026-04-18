"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Policy = {
  id: number;
  name: string;
  document: any;
  role_names: string[];
};

export default function PolicyEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const policyId = params.id;

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [docText, setDocText] = useState<string>("");
  const [initialText, setInitialText] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const locked = policy?.name === "super-admin-all";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/auth/v1/admin/policies/${policyId}`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Policy = await res.json();
        setPolicy(data);
        const pretty = JSON.stringify(data.document, null, 2);
        setDocText(pretty);
        setInitialText(pretty);
      } catch (e: any) {
        setSaveError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [policyId]);

  // 即時檢查 JSON 語法
  useEffect(() => {
    if (!docText) {
      setParseError(null);
      return;
    }
    try {
      JSON.parse(docText);
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
    }
  }, [docText]);

  const dirty = docText !== initialText;

  const save = async () => {
    let doc: any;
    try {
      doc = JSON.parse(docText);
    } catch (e: any) {
      setSaveError(`JSON 解析失敗：${e.message}`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/auth/v1/admin/policies/${policyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ document: doc }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInitialText(docText);
      alert("已儲存並刷新權限快取");
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDocText(initialText);
    setSaveError(null);
  };

  if (loading) return <div className="text-gray-500">載入中…</div>;
  if (!policy) return <div className="bg-red-50 text-red-700 p-3 rounded">錯誤：{saveError ?? "找不到 policy"}</div>;

  return (
    <div>
      <div className="mb-4">
        <div className="text-sm text-gray-500">
          <a href="/admin/policies" className="hover:underline">← 回到 Policy 列表</a>
        </div>
        <h1 className="text-xl font-bold mt-1">
          編輯 Policy：<span className="font-mono text-red-700">{policy.name}</span>
          {locked && <span className="ml-2 text-sm text-gray-500">🔒 系統 policy（只讀）</span>}
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          綁定角色：{policy.role_names.length > 0 ? policy.role_names.join(", ") : "（未綁任何角色）"}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <div>
          <label className="block text-sm mb-2 flex items-center">
            <span className="font-semibold">Policy document (JSON)</span>
            {dirty && !locked && <span className="ml-2 text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded">未儲存</span>}
            {parseError && <span className="ml-2 text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded">JSON 語法錯</span>}
          </label>
          <textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            disabled={locked}
            spellCheck={false}
            rows={24}
            className="w-full border rounded px-3 py-2 text-xs font-mono disabled:bg-gray-50"
          />
          {parseError && <p className="text-xs text-red-600 mt-1 font-mono">{parseError}</p>}
        </div>

        {saveError && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{saveError}</div>}

        <div className="flex gap-2 pt-2 border-t">
          <button
            onClick={save}
            disabled={locked || saving || !dirty || !!parseError}
            className="bg-red-700 text-white px-6 py-2 rounded hover:bg-red-800 disabled:opacity-50"
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
          <button
            onClick={reset}
            disabled={locked || !dirty}
            className="px-6 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            還原
          </button>
          <button
            onClick={() => router.push("/admin/policies")}
            className="ml-auto px-6 py-2 border rounded hover:bg-gray-50"
          >
            返回列表
          </button>
        </div>

        <details className="text-xs text-gray-500 pt-2">
          <summary className="cursor-pointer">Policy document 格式提示</summary>
          <pre className="mt-2 bg-gray-50 p-3 rounded overflow-x-auto">{`{
  "statements": [
    {
      "effect": "allow" | "deny",
      "actions":   ["service:resource:verb", "..."],
      "resources": ["service:tenant/\${auth:tenant_id}/...", "..."]
    }
  ]
}
可用變數：\${auth:user_id} / \${auth:tenant_id} / \${auth:role} / \${path.{name}}`}
          </pre>
        </details>
      </div>
    </div>
  );
}
