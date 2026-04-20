from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.patient import Patient


async def match_patient(
    db: AsyncSession,
    ocr_name: str,
    ocr_birth_date: date | None,
    tenant_id: int,
    ocr_chart_no: str | None = None,
) -> dict:
    """
    比對 OCR 結果與病患資料（限同 tenant）。
    回傳: {"status": "matched"|"ambiguous"|"unmatched", "patient_id": int|None, "candidates": list}

    優先順序：
      1. chart_no（病歷號）→ 同 tenant 內 unique（0006 partial index），命中即為 matched。
      2. 姓名 + 生日 fallback（舊流程）。
    """
    if ocr_chart_no:
        stmt = select(Patient).where(
            Patient.chart_no == ocr_chart_no,
            Patient.tenant_id == tenant_id,
        )
        result = await db.execute(stmt)
        by_chart = result.scalars().first()
        if by_chart is not None:
            return {
                "status": "matched",
                "patient_id": by_chart.id,
                "candidates": [by_chart.id],
            }

    stmt = select(Patient).where(
        Patient.name == ocr_name,
        Patient.tenant_id == tenant_id,
    )
    result = await db.execute(stmt)
    candidates = result.scalars().all()

    if len(candidates) == 0:
        return {"status": "unmatched", "patient_id": None, "candidates": []}

    if len(candidates) == 1:
        return {
            "status": "matched",
            "patient_id": candidates[0].id,
            "candidates": [candidates[0].id],
        }

    if ocr_birth_date:
        exact = [c for c in candidates if c.birth_date == ocr_birth_date]
        if len(exact) == 1:
            return {
                "status": "matched",
                "patient_id": exact[0].id,
                "candidates": [c.id for c in candidates],
            }

    return {
        "status": "ambiguous",
        "patient_id": None,
        "candidates": [c.id for c in candidates],
    }
