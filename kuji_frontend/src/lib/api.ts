// Kuji API wrapper — 抄 bye-weight/frontend 的 pattern：cookie-based、401 auto-refresh。

const API_BASE  = process.env.NEXT_PUBLIC_API_BASE_URL  || "/kuji/api/v1";
const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_BASE_URL || "/auth/v1";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function handleUnauthorized() {
  if (typeof window !== "undefined") {
    window.location.href = "/kuji/login";
  }
}

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const doFetch = () => fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshRes = await fetch(`${AUTH_BASE}/refresh`, { method: "POST", credentials: "include" });
    if (!refreshRes.ok) { handleUnauthorized(); throw new ApiError(401, "session expired"); }
    res = await doFetch();
    if (res.status === 401) { handleUnauthorized(); throw new ApiError(401, "session expired"); }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function passwordLogin(email: string, password: string) {
  const res = await fetch(`${AUTH_BASE}/password-login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new ApiError(res.status, res.status === 401 ? "帳號或密碼錯誤" : msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ user_id: number; role: string; tenant_id: number }>;
}

export async function logout() {
  await fetch(`${AUTH_BASE}/logout`, { method: "POST", credentials: "include" }).catch(() => {});
}

export async function authMe() {
  const res = await fetch(`${AUTH_BASE}/me`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json() as Promise<{ user_id: number; role: string; tenant_id: number }>;
}
