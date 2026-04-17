"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { initLiff } from "@/lib/auth";

export default function LiffPage() {
  const router = useRouter();
  const [status, setStatus] = useState("正在登入...");

  useEffect(() => {
    initLiff().then((result) => {
      if (result) {
        router.push("/patient/food-logs");
      } else {
        setStatus("登入失敗，請重試");
      }
    });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-lg text-gray-600">{status}</p>
    </div>
  );
}
