import liff from "@line/liff";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || "";

export async function initLiff() {
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
    return null;
  }

  const accessToken = liff.getAccessToken();
  if (!accessToken) return null;

  // 用 LINE access token 換 JWT（存入 HttpOnly cookie）
  const res = await fetch("/auth/line-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ access_token: accessToken }),
  });

  if (!res.ok) return null;
  return res.json();
}
