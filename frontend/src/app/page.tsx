import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-8">金鑽減重</h1>
      <p className="text-gray-600 mb-8">LINE 醫療病患追蹤平台</p>
      <div className="grid grid-cols-2 gap-4 w-full max-w-md">
        <Link
          href="/patient/inbody"
          className="bg-white rounded-xl p-6 text-center shadow hover:shadow-md transition"
        >
          <div className="text-3xl mb-2">📊</div>
          <div className="font-medium">身體組成</div>
        </Link>
        <Link
          href="/patient/food-logs"
          className="bg-white rounded-xl p-6 text-center shadow hover:shadow-md transition"
        >
          <div className="text-3xl mb-2">🍽️</div>
          <div className="font-medium">飲食記錄</div>
        </Link>
        <Link
          href="/patient/visits"
          className="bg-white rounded-xl p-6 text-center shadow hover:shadow-md transition"
        >
          <div className="text-3xl mb-2">🏥</div>
          <div className="font-medium">看診紀錄</div>
        </Link>
        <Link
          href="/patient/notifications"
          className="bg-white rounded-xl p-6 text-center shadow hover:shadow-md transition"
        >
          <div className="text-3xl mb-2">🔔</div>
          <div className="font-medium">通知設定</div>
        </Link>
      </div>
    </main>
  );
}
