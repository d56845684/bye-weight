import type { Metadata } from "next";
import { PrefsProvider } from "@/lib/prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: "酷記 Kuji",
  description: "Turn every conversation into work that runs itself",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;600;700&display=swap"
        />
      </head>
      <body data-theme="dark" data-variant="A" className="font-sans">
        <PrefsProvider>{children}</PrefsProvider>
      </body>
    </html>
  );
}
