const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

export async function fetchAPI<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (res.status === 401) {
    // 嘗試 refresh token
    const refreshRes = await fetch("/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (refreshRes.ok) {
      // 重試原始請求
      const retryRes = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      if (!retryRes.ok) throw new Error(`API error: ${retryRes.status}`);
      return retryRes.json();
    }
    // Refresh 也失敗，導向登入
    window.location.href = "/liff";
    throw new Error("unauthorized");
  }

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
