import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "金鑽減重 - 病患追蹤平台",
  description: "LINE 醫療病患追蹤系統",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
