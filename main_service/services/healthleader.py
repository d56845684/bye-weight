"""Healthleader 後台 client：登入 + 抓抽血報告 SVG。

對映 docs 的 n8n flow（Healthleader 抽血報告同步到 Google Sheet v10）：
  node 1-4  → login()：GET 登入頁抓 CSRF token → POST 表單登入（不跟隨 redirect）
  node 5    → list_reports(mrno)：POST GetDataV3，回該病歷號的報告清單
  node 7    → report_svg_url(report_id)：POST ReportPartial，回報告 SVG 的 URL
  node 7.6  → fetch_svg(url)：POST 取 SVG 原文（給 healthleader_parse 解析）

session 共用一個 httpx.AsyncClient cookie jar：登入頁種的 antiforgery cookie +
登入後的 session cookie 都由 jar 自動帶下去，不用像 n8n 手動串 cookie 字串。

憑證走 env（單一共用帳號，多租戶先共用）：
  HEALTHLEADER_BASE_URL / HL_ACCOUNT / HL_HOSPITAL_NO / HL_PASSWORD

所有外呼包 try/except httpx.HTTPError：登入失敗 raise，逐病患 / 逐報告的查詢
失敗回空 / None，讓 sync 呼叫端記 error 計數而不是整批炸掉。
"""
import logging
import os
import re
from datetime import datetime

import httpx

log = logging.getLogger(__name__)

BASE_URL = os.getenv("HEALTHLEADER_BASE_URL", "https://manage.healthleader.com.tw")
HL_ACCOUNT = os.getenv("HL_ACCOUNT", "")
HL_HOSPITAL_NO = os.getenv("HL_HOSPITAL_NO", "")
HL_PASSWORD = os.getenv("HL_PASSWORD", "")

# n8n node 2 的 CSRF 抓法：name 在前、value 在後（ASP.NET antiforgery hidden input）
_CSRF_RE = re.compile(
    r'name="__RequestVerificationToken"[^>]*?value="([^"]+)"', re.DOTALL
)
# 保險：少數 render 會 value 在前 name 在後
_CSRF_RE_ALT = re.compile(
    r'value="([^"]+)"[^>]*?name="__RequestVerificationToken"', re.DOTALL
)

# 報告清單查詢起始日：沿用 n8n 寫死的下界（涵蓋所有歷史報告）
_DETECT_DATE_FROM = "2013-12-01"


class HealthleaderError(RuntimeError):
    """登入失敗 / 憑證未設定等不可恢復錯誤。"""


class HealthleaderClient:
    """async context manager：

        async with HealthleaderClient() as hl:
            await hl.login()
            reports = await hl.list_reports("12345")
            for r in reports:
                url = await hl.report_svg_url(r["ID"])
                svg = await hl.fetch_svg(url)
    """

    def __init__(self, timeout: float = 30.0):
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "HealthleaderClient":
        # follow_redirects=False：登入成功是 302，我們只要 Set-Cookie，不要跟過去
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=self._timeout,
            follow_redirects=False,
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def _c(self) -> httpx.AsyncClient:
        if self._client is None:
            raise HealthleaderError("client used outside 'async with' context")
        return self._client

    async def login(self) -> None:
        """GET 登入頁取 CSRF token（antiforgery cookie 自動進 jar）→ POST 表單登入。
        憑證未設定或登入回應不像成功 → raise HealthleaderError。"""
        # HL_HOSPITAL_NO 可留空（表單仍帶但允許空字串）；只有帳號 / 密碼是必要的
        if not (HL_ACCOUNT and HL_PASSWORD):
            raise HealthleaderError(
                "Healthleader 憑證未設定（需要 HL_ACCOUNT / HL_PASSWORD；HL_HOSPITAL_NO 可留空）"
            )
        try:
            page = await self._c.get("/Account/Login")
            token = self._extract_csrf(page.text)
            if not token:
                raise HealthleaderError("登入頁找不到 __RequestVerificationToken")
            resp = await self._c.post(
                "/Account/Login",
                data={
                    "Account": HL_ACCOUNT,
                    "HospitalNo": HL_HOSPITAL_NO,
                    "Password": HL_PASSWORD,
                    "__RequestVerificationToken": token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError as e:
            raise HealthleaderError(f"Healthleader 登入連線失敗：{e}") from e

        # 成功通常是 302 轉址到後台；200 多半是停在登入頁（帳密錯）。
        # 用 cookie jar 是否拿到 session cookie 當判定 —— 失敗就沒有 .ASPXAUTH / session。
        if resp.status_code not in (301, 302, 303) and resp.status_code != 200:
            raise HealthleaderError(f"Healthleader 登入回應異常：HTTP {resp.status_code}")

    @staticmethod
    def _extract_csrf(html: str) -> str | None:
        m = _CSRF_RE.search(html or "")
        if m:
            return m.group(1)
        m = _CSRF_RE_ALT.search(html or "")
        return m.group(1) if m else None

    async def list_reports(self, mrno: str) -> list[dict]:
        """POST GetDataV3 取某病歷號的報告清單。回 data[]（每筆含 ID / Name /
        MRNo / DetectDate / DetectNo / CustomerName）。失敗回 []。"""
        if not mrno:
            return []
        today = datetime.now().strftime("%Y-%m-%d")
        body = {
            "draw": "1",
            "start": "0",
            "length": "200",
            "IsShowNone": "false",
            "IsShowOk": "true",
            "IsRRSort": "true",
            "IsPrivacyProtection": "false",
            "IsSisan": "false",
            "DetectKind02": "false",
            "DetectKind03": "false",
            "CustomerName": "",
            "Name": "",
            "DetectDate[0]": _DETECT_DATE_FROM,
            "DetectDate[1]": today,
            "MRNo": mrno,
            "DetectNo": "",
            "IDNo": "",
            "Birthday": "",
        }
        try:
            resp = await self._c.post(
                "/UPL/ReleaseReport/GetDataV3",
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            data = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("GetDataV3 失敗 mrno=%s: %s", mrno, e)
            return []
        reports = data.get("data") if isinstance(data, dict) else None
        return reports if isinstance(reports, list) else []

    async def report_svg_url(self, report_id: str) -> str | None:
        """POST ReportPartial 取報告 SVG 的 URL。失敗 / 非 success → None。"""
        if not report_id:
            return None
        try:
            resp = await self._c.post(
                f"/UPL/ReleaseReport/ReportPartial/TY/{report_id}/true/true",
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            data = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("ReportPartial 失敗 id=%s: %s", report_id, e)
            return None
        if isinstance(data, dict) and data.get("status") == "success":
            return data.get("svgurl")
        return None

    async def fetch_svg(self, url: str) -> str | None:
        """POST 取 SVG 原文。失敗回 None。url 可能是絕對或相對路徑。"""
        if not url:
            return None
        try:
            resp = await self._c.post(url)
            return resp.text
        except httpx.HTTPError as e:
            log.warning("fetch_svg 失敗 url=%s: %s", url, e)
            return None
