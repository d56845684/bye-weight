// 登入成功後的導頁規則：依 role 導到各自首頁；role=patient 額外檢查是否已建 profile，
// 沒有就導去 /patient/register（LINE / Google / 任何登入來源都套用同一規則）。

export const ROLE_HOME: Record<string, string> = {
  patient: "/patient/food-logs",
  staff: "/staff/inbody",
  nutritionist: "/nutritionist/push",
  admin: "/admin/patients",
  super_admin: "/admin/tenants",
};

// GET /patients/me：404 代表 patient profile 還沒建，導去 /patient/register；
// 其餘情況（包含網路錯誤）走原本的 nextPath / role home，不阻擋流程。
export async function resolvePatientHome(nextPath: string | null = null): Promise<string> {
  try {
    const res = await fetch("/api/v1/patients/me", { credentials: "include" });
    if (res.status === 404) return "/patient/register";
  } catch {
    // ignore — 不因 profile 檢查失敗擋住登入
  }
  return nextPath ?? ROLE_HOME.patient;
}

// 登入回應（含 role）後決定導頁目標：patient 走 profile 檢查，其餘 role 直接對表查首頁。
export async function resolvePostLogin(role: string, nextPath: string | null = null): Promise<string> {
  if (role === "patient") return resolvePatientHome(nextPath);
  return nextPath ?? ROLE_HOME[role] ?? ROLE_HOME.patient;
}
