export default function NutritionistLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-green-700 text-white px-4 py-3">
        <div className="max-w-2xl mx-auto font-bold">金鑽減重 - 營養師介面</div>
      </nav>
      <main className="max-w-2xl mx-auto p-4">{children}</main>
    </div>
  );
}
