"""實際打 Healthleader 後台的 live 測試（會真的登入 + 連外、需網路 + 憑證）。

**預設跳過**。要跑必須兩個條件都成立：
  - 環境變數 RUN_LIVE_HL=1（明確 opt-in）
  - HL_ACCOUNT / HL_HOSPITAL_NO / HL_PASSWORD 都有設

跑法（docker-only，憑證從 .env.docker 帶入；先把 HL_* 填好）：
  docker run --rm -v "$PWD/main_service":/app -w /app \\
    --env-file main_service/.env.docker -e RUN_LIVE_HL=1 \\
    -e HL_TEST_CHART_NO=TY12345 \\
    python:3.11-slim sh -c \\
    "pip install -q -r requirements.txt && python -m pytest tests/test_live_healthleader.py -v -s"

兩支測試：
  - test_live_login_succeeds：只驗能登入（最低門檻）。
  - test_live_fetch_report_end_to_end：登入 → 用 HL_TEST_CHART_NO 抓報告清單 → 取第一筆
    的 SVG → 解析，**完整打通到抽血報告網站的 API**。只需給一個「院區病歷號」
    （如 "TY12345"，純數字 "12345" 也行）——查詢用的 MRNo 由它的數字段推出，
    跟 production 從 patients.chart_no 推法一致；HL病歷號是回傳值，不用給。
    沒設 HL_TEST_CHART_NO 時此支自動跳過。不鎖定回傳筆數 / 數值（會浮動）。
"""
import os
import re

import pytest

from services.healthleader import HealthleaderClient
from services.healthleader_parse import parse_lab_svg

pytestmark = [
    pytest.mark.skipif(
        not os.getenv("RUN_LIVE_HL"),
        reason="live Healthleader test：設 RUN_LIVE_HL=1 才跑（會真的登入連外）",
    ),
    pytest.mark.skipif(
        not (os.getenv("HL_ACCOUNT") and os.getenv("HL_PASSWORD")),
        reason="需要 HL_ACCOUNT / HL_PASSWORD（HL_HOSPITAL_NO 可留空）",
    ),
]


@pytest.mark.asyncio
async def test_live_login_succeeds():
    """真的登入 Healthleader（不丟 HealthleaderError 即視為通過）。"""
    async with HealthleaderClient() as hl:
        await hl.login()
        print("\n[live HL] login ok")


@pytest.mark.skipif(
    not os.getenv("HL_TEST_CHART_NO"),
    reason="需要 HL_TEST_CHART_NO（一個真的有報告的院區病歷號）才能端到端驗",
)
@pytest.mark.asyncio
async def test_live_fetch_report_end_to_end():
    """端到端打抽血報告網站 API：登入 → list_reports → SVG → parse。

    證明整條對外鏈路（不含 DB）是通的。斷言只看「拿得到報告清單、SVG 是 SVG」，
    解析結果允許為空（看該病歷號報告版型）。"""
    chart_no = os.getenv("HL_TEST_CHART_NO")
    # 跟 production 同一套：取院區病歷號的數字段當查詢 MRNo（"TY12345"→"12345"）
    m = re.search(r"\d+", chart_no or "")
    assert m, f"HL_TEST_CHART_NO 取不到數字：{chart_no!r}"
    mrno = m.group()
    async with HealthleaderClient() as hl:
        await hl.login()
        reports = await hl.list_reports(mrno)
        print(f"\n[live HL] mrno={mrno} 報告數={len(reports)}")
        assert isinstance(reports, list)
        assert reports, "該病歷號查不到任何報告，換一個有資料的 HL_TEST_MRNO"

        first = reports[0]
        url = await hl.report_svg_url(str(first.get("ID")))
        assert url, f"ReportPartial 沒回 svgurl：{first}"
        svg = await hl.fetch_svg(url)
        assert svg and "<svg" in svg, "fetch_svg 沒拿到 SVG 內容"

        lab = parse_lab_svg(svg)
        print(f"[live HL] DetectDate={first.get('DetectDate')} 解析欄位={list(lab.keys())}")
