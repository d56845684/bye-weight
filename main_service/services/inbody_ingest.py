"""InBody 攝取流程：OCR → 姓名+生日比對 → 寫入 inbody_records 或 inbody_pending。

供 LINE webhook（staff 傳圖）+ 將來可能的 admin 後台 multipart upload 共用。
caller 自己處理：身份 / 權限驗證、image 取得（bytes）、結果如何回覆使用者。
"""
from datetime import date, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from models.inbody import InbodyPending, InbodyRecord
from services.matching import match_patient
from services.ocr import ocr_inbody
from utils.cache import invalidate


async def ingest_inbody(
    db: AsyncSession,
    uploader_user_id: int,
    tenant_id: int,
    image_bytes: bytes,
    image_url: str | None = None,
) -> dict:
    """跑 OCR + matching + DB 寫入。

    回傳 dict：
      {"status": "matched", "patient_id": int, "patient_name": str}
      {"status": "ambiguous", "candidates": [int, ...]}
      {"status": "unmatched", "ocr_name": str | None}
      {"status": "ocr_failed", "reason": str}

    注意：tenant_id 限縮 patient 搜尋範圍；database session 層的 RLS 也會
    再擋一次（defense-in-depth）。
    """
    try:
        ocr_result = await ocr_inbody(image_bytes)
    except Exception as e:
        pending = InbodyPending(
            tenant_id=tenant_id,
            uploaded_by=uploader_user_id,
            image_url=image_url,
            status="ocr_failed",
        )
        db.add(pending)
        await db.commit()
        return {"status": "ocr_failed", "reason": str(e)}

    ocr_name = (ocr_result.get("name") or "").strip()
    ocr_chart_no = (ocr_result.get("chart_no") or "").strip() or None
    ocr_birth: date | None = None
    if ocr_result.get("birth_date"):
        try:
            ocr_birth = date.fromisoformat(ocr_result["birth_date"])
        except (ValueError, TypeError):
            ocr_birth = None

    match = await match_patient(
        db,
        ocr_name,
        ocr_birth,
        tenant_id=tenant_id,
        ocr_chart_no=ocr_chart_no,
    )

    if match["status"] == "matched":
        record = InbodyRecord(
            patient_id=match["patient_id"],
            tenant_id=tenant_id,
            uploaded_by=uploader_user_id,
            measured_at=datetime.utcnow(),
            weight=ocr_result.get("weight"),
            bmi=ocr_result.get("bmi"),
            body_fat_pct=ocr_result.get("body_fat_pct"),
            muscle_mass=ocr_result.get("muscle_mass"),
            visceral_fat=ocr_result.get("visceral_fat"),
            metabolic_rate=ocr_result.get("metabolic_rate"),
            image_url=image_url,
            raw_json=ocr_result,
            match_status="matched",
        )
        db.add(record)
        await db.commit()
        await invalidate(f"cache:inbody:{match['patient_id']}")
        return {
            "status": "matched",
            "patient_id": match["patient_id"],
            "patient_name": ocr_name,
        }

    # ambiguous / unmatched → 進 pending 等人工確認
    pending = InbodyPending(
        tenant_id=tenant_id,
        uploaded_by=uploader_user_id,
        image_url=image_url,
        ocr_name=ocr_name or None,
        ocr_birth_date=ocr_birth,
        ocr_chart_no=ocr_chart_no,
        ocr_data=ocr_result,
        status=match["status"],
    )
    db.add(pending)
    await db.commit()

    if match["status"] == "ambiguous":
        return {"status": "ambiguous", "candidates": match["candidates"]}
    return {"status": "unmatched", "ocr_name": ocr_name or None}
