from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.patient import Patient


async def match_patient(
    db: AsyncSession, ocr_name: str, ocr_birth_date: date | None
) -> dict:
    """
    比對 OCR 結果與病患資料。
    回傳: {"status": "matched"|"ambiguous"|"unmatched", "patient_id": int|None, "candidates": list}
    """
    # 先用姓名比對
    stmt = select(Patient).where(Patient.name == ocr_name)
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

    # 多筆同名：用生日進一步篩選
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
