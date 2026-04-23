"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authMe } from "@/lib/api";

// Kuji root：有登入 → /kuji/board；沒登入 → /kuji/login。
// basePath="/kuji"：router.replace 不要帶前綴
export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    authMe().then(me => {
      router.replace(me ? "/board" : "/login");
    });
  }, [router]);
  return <div style={{ padding: 40, textAlign: "center", color: "var(--k-fg3)" }}>載入中…</div>;
}
