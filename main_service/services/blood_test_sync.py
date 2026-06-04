"""抽血報告同步 orchestrator：對映整條 n8n flow，但 source = 自家 patients、
sink = app_db 的 blood_test_reports。

流程：
  1. 撈同 tenant 的 patients（chart_no 形如 院區代碼+數字，e.g. "TY12345"）
  2. HealthleaderClient 登入一次
  3. 逐病患：chart_no 取數字段當 MRNo → list_reports → 逐報告抓 SVG → 解析 → upsert
  4. 去重 key = (tenant_id, hl_report_id)；DB partial unique index 當最後防線

跑在 session_context(tenant_id, user_id) 內：RLS + audit_autofill 自動生效
（見 database.py）。每筆報告之間 sleep 2s，跟 n8n 的 batchInterval 一致，避免打爆 HL。
"""
import asyncio
import logging
import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.blood_test import BloodTestReport
from models.patient import Patient
from services.healthleader import HealthleaderClient, HealthleaderError
from services.healthleader_parse import parse_lab_svg

log = logging.getLogger(__name__)

# 院區病歷號：字母院區代碼 + 數字（n8n: ^([A-Za-z]+)(\d+)$）。HL 查詢只要數字段。
_CHART_RE = re.compile(r"^([A-Za-z]+)(\d+)$")

# GetDataV3 回傳的欄位常包 HTML（e.g. DetectDate=<div ...>2026-03-30</div>），
# 對齊 n8n node 6 的 strip()：去標籤 + trim 後才使用。
_TAG_RE = re.compile(r"<[^>]*>")


def _clean(v) -> str | None:
    """去 HTML 標籤 + trim；空 → None。"""
    if v is None:
        return None
    s = _TAG_RE.sub("", str(v)).strip()
    return s or None

# HL DetectDate 可能的格式（不同報告 / 院區用語有差），依序嘗試。
_DATE_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d")

# 每筆報告間隔（秒），對齊 n8n batchInterval=2000ms
_THROTTLE_SEC = 2.0


def _mrno_from_chart(chart_no: str | None) -> str | None:
    """chart_no "TY12345" → "12345"；不符格式 → None（該病患跳過）。"""
    if not chart_no:
        return None
    m = _CHART_RE.match(chart_no.strip())
    return m.group(2) if m else None


def _parse_detect_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = raw.strip()
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


async def sync_blood_tests(
    db: AsyncSession,
    tenant_id: int,
    user_id: int,
    patient_id: int | None = None,
    throttle_sec: float = _THROTTLE_SEC,
) -> dict:
    """同步抽血報告。

    回 {"patients": n, "added": x, "skipped": y, "errors": z}。
    patient_id 給定時只同步該病患；否則同步整個 tenant 有合格 chart_no 的病患。
    """
    conds = [
        Patient.tenant_id == tenant_id,
        Patient.deleted_at.is_(None),
        Patient.chart_no.isnot(None),
    ]
    if patient_id is not None:
        conds.append(Patient.id == patient_id)
    patients = (await db.execute(select(Patient).where(*conds))).scalars().all()

    # 既有 hl_report_id（同 tenant，RLS 已自動限縮）→ 去重
    existing = set(
        (await db.execute(
            select(BloodTestReport.hl_report_id).where(
                BloodTestReport.tenant_id == tenant_id,
                BloodTestReport.deleted_at.is_(None),
            )
        )).scalars().all()
    )

    summary = {"patients": 0, "added": 0, "skipped": 0, "errors": 0}

    async with HealthleaderClient() as hl:
        try:
            await hl.login()
        except HealthleaderError as e:
            log.error("Healthleader 登入失敗，同步中止：%s", e)
            summary["errors"] += 1
            return summary

        for p in patients:
            mrno = _mrno_from_chart(p.chart_no)
            if not mrno:
                continue
            summary["patients"] += 1
            reports = await hl.list_reports(mrno)

            for r in reports:
                # GetDataV3 欄位包 HTML，一律先 _clean 去標籤（對齊 n8n node 6）
                report_id = _clean(r.get("ID"))
                if not report_id:
                    summary["errors"] += 1
                    continue
                if report_id in existing:
                    summary["skipped"] += 1
                    continue

                raw_date = _clean(r.get("DetectDate"))
                test_date = _parse_detect_date(raw_date)
                if test_date is None:
                    log.warning("報告 %s DetectDate 無法解析：%r", report_id, raw_date)
                    summary["errors"] += 1
                    continue

                try:
                    url = await hl.report_svg_url(report_id)
                    svg = await hl.fetch_svg(url) if url else None
                    lab = parse_lab_svg(svg or "")
                except Exception as e:  # noqa: BLE001 — 單筆失敗不擋整批
                    log.warning("報告 %s 取 SVG / 解析失敗：%s", report_id, e)
                    summary["errors"] += 1
                    continue

                db.add(BloodTestReport(
                    patient_id=p.id,
                    tenant_id=tenant_id,
                    hl_report_id=report_id,
                    hl_mrno=_clean(r.get("MRNo")),
                    detect_no=_clean(r.get("DetectNo")),
                    clinic_name=_clean(r.get("CustomerName")),
                    test_date=test_date,
                    lab_values=lab or None,
                    svg_url=url,
                ))
                existing.add(report_id)
                summary["added"] += 1

                if throttle_sec:
                    await asyncio.sleep(throttle_sec)

    await db.commit()
    return summary
