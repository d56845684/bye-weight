// 登入成功後的導頁規則：依 role 導到各自首頁。
//
// role=patient 的「沒建 profile → /patient/register」這道 gate 由 PatientLayout
// 負責：在 /patient/* 下進第一個頁面時才 fetch /patients/me，避免登入關鍵路徑多
// 打一輪 API（Cloudflared tunnel / 行動網路下每多一個 request 都很有感）。

export const ROLE_HOME: Record<string, string> = {
  patient: "/patient/food-logs",
  staff: "/staff/inbody",
  nutritionist: "/nutritionist/push",
  admin: "/admin/patients",
  super_admin: "/admin/tenants",
};

export function resolvePostLogin(role: string, nextPath: string | null = null): string {
  return nextPath ?? ROLE_HOME[role] ?? ROLE_HOME.patient;
}
