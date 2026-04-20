const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

// ApiError：讓呼叫端能透過 .status 分辨 401 / 403 / 5xx 等，而不用去解字串。
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// huma v2 回 RFC 7807 envelope：{$schema, title, status, detail, errors?}
// 直接把整包 JSON 甩到 UI 上很不友善，這裡抽出 detail/title 給使用者看。
export function humaMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j?.errors) && j.errors.length) {
      // validation：把每條 path + message 串起來
      return j.errors
        .map((e: any) => (e.location ? `${e.location}: ` : "") + (e.message ?? ""))
        .filter(Boolean)
        .join("；");
    }
    return j?.detail || j?.title || body;
  } catch {
    return body;
  }
}

// 集中式 status interceptor：401 試 refresh → 失敗導 /liff；403 導 /forbidden。
// Pages 繼續維持 .catch(console.error) 即可。
function handleUnauthorized(): never {
  if (typeof window !== "undefined") window.location.href = "/liff";
  throw new ApiError(401, "unauthorized");
}
function handleForbidden(): never {
  if (typeof window !== "undefined") {
    const from = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/forbidden?from=${from}`;
  }
  throw new ApiError(403, "forbidden");
}

export async function fetchAPI<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const doFetch = async () => {
    try {
      return await fetch(url, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...options,
      });
    } catch (e) {
      // fetch() 在連線層失敗會拋 TypeError「Load failed」/「Failed to fetch」。
      // 包成 ApiError(0, ...) 讓 caller 能統一靠 instanceof 判斷，且附上 URL 便於診斷。
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError(0, `network error: ${msg} (${options?.method || "GET"} ${url})`);
    }
  };

  let res = await doFetch();

  if (res.status === 401) {
    const refreshRes = await fetch("/auth/v1/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!refreshRes.ok) handleUnauthorized();
    res = await doFetch();
    if (res.status === 401) handleUnauthorized();
  }

  if (res.status === 403) handleForbidden();

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, humaMessage(body) || `API error: ${res.status}`);
  }
  return res.json();
}
