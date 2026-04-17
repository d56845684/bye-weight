export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-red-700 text-white px-4 py-3">
        <div className="max-w-4xl mx-auto font-bold">金鑽減重 - 管理後台</div>
      </nav>
      <main className="max-w-4xl mx-auto p-4">{children}</main>
    </div>
  );
}
