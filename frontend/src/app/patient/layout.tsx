"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Direction B: iOS-style bottom tab nav，mint/teal 主色系。
// 5 個 tab：首頁 / 身體 / 飲食 / 看診 / 趨勢。
const TABS: { href: string; zh: string; icon: string }[] = [
  { href: "/patient",           zh: "首頁", icon: "M3 11l9-8 9 8v10H3z" },
  { href: "/patient/inbody",    zh: "身體", icon: "M12 2a3 3 0 110 6 3 3 0 010-6zM8 22v-8l-3-2v-5l4 1 3-1 3 1 4-1v5l-3 2v8" },
  { href: "/patient/food-logs", zh: "飲食", icon: "M6 2v9a3 3 0 003 3v8M10 2v5a2 2 0 01-4 0V2M16 22V2c-2 0-4 3-4 7s2 6 4 6v7" },
  { href: "/patient/visits",    zh: "看診", icon: "M4 5h16v14H4zM4 9h16M8 13h4" },
  { href: "/patient/trends",    zh: "趨勢", icon: "M3 18l6-6 4 4 8-10" },
];

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/patient";
  // 精確 match 首頁；其他 prefix match
  const isActive = (href: string) =>
    href === "/patient" ? pathname === "/patient" : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-[#f4f6f5] flex flex-col">
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-5 pb-24">
        {children}
      </main>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-black/5 pt-2 pb-6">
        <div className="max-w-md mx-auto flex justify-around">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-semibold transition-colors ${
                  active ? "text-teal-600" : "text-gray-400"
                }`}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.icon} />
                </svg>
                <span>{t.zh}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
