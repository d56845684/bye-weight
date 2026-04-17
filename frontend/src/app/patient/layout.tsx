import Link from "next/link";

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg">
            金鑽減重
          </Link>
          <div className="flex gap-4 text-sm">
            <Link href="/patient/inbody" className="hover:text-blue-600">
              身體組成
            </Link>
            <Link href="/patient/food-logs" className="hover:text-blue-600">
              飲食記錄
            </Link>
            <Link href="/patient/visits" className="hover:text-blue-600">
              看診紀錄
            </Link>
          </div>
        </div>
      </nav>
      <main className="max-w-lg mx-auto p-4">{children}</main>
    </div>
  );
}
