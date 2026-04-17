"use client";

import { useState } from "react";
import { fetchAPI } from "@/lib/api";

export default function StaffInbodyPage() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setResult(null);

    try {
      // 1. 取得 presigned URL
      const { upload_url, blob_path } = await fetchAPI<{
        upload_url: string;
        blob_path: string;
      }>("/upload/presigned-url", {
        method: "POST",
        body: JSON.stringify({ file_type: "inbody" }),
      });

      // 2. 上傳到 GCS
      await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: file,
      });

      // 3. 觸發 OCR + 配對
      const ocrResult = await fetchAPI<{ status: string; patient_id?: number }>(
        "/inbody",
        {
          method: "POST",
          body: JSON.stringify({
            image_url: blob_path,
            image_bytes: await file.arrayBuffer(),
          }),
        }
      );

      setResult(
        ocrResult.status === "matched"
          ? `配對成功！病患 ID: ${ocrResult.patient_id}`
          : `狀態: ${ocrResult.status}，需要人工確認`
      );
    } catch (err) {
      setResult(`上傳失敗: ${err}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">上傳 InBody 報告</h1>
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <label className="block">
          <span className="text-gray-700">選擇 InBody 報告照片</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleUpload}
            disabled={uploading}
            className="mt-2 block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0
              file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
        </label>
        {uploading && <p className="mt-4 text-blue-600">上傳 + OCR 辨識中...</p>}
        {result && (
          <p className="mt-4 p-3 bg-gray-50 rounded text-sm">{result}</p>
        )}
      </div>
    </div>
  );
}
