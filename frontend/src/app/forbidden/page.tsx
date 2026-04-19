"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function Inner() {
  const from = useSearchParams().get("from");
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold text-red-700 mb-2">權限不足</h1>
        <p className="text-sm text-gray-600">
          您的角色無法存取此資源，請聯繫管理員。
        </p>
        {from && (
          <p className="text-xs text-gray-400 mt-3 font-mono break-all">
            {from}
          </p>
        )}
        <div className="mt-6">
          <Link
            href="/liff"
            className="text-sm text-blue-700 hover:underline"
          >
            回到登入
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ForbiddenPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">載入中…</div>}>
      <Inner />
    </Suspense>
  );
}
