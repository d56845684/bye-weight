from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user, current_patient
from models.inbody import InbodyRecord, InbodyPending
from models.patient import Patient
from services.ocr import ocr_inbody
from services.matching import match_patient
from utils.cache import invalidate

router = APIRouter(prefix="/inbody", tags=["inbody"])


@router.get("/history")
async def inbody_history(
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(InbodyRecord)
        .where(
            InbodyRecord.patient_id == patient.id,
            InbodyRecord.tenant_id == user["tenant_id"],
        )
        .order_by(InbodyRecord.measured_at.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    records = result.scalars().all()
    return [
        {
            "id": r.id,
            "measured_at": r.measured_at.isoformat(),
            "weight": float(r.weight) if r.weight else None,
            "bmi": float(r.bmi) if r.bmi else None,
            "body_fat_pct": float(r.body_fat_pct) if r.body_fat_pct else None,
            "muscle_mass": float(r.muscle_mass) if r.muscle_mass else None,
            "visceral_fat": r.visceral_fat,
            "metabolic_rate": float(r.metabolic_rate) if r.metabolic_rate else None,
        }
        for r in records
    ]


@router.post("")
async def upload_inbody(
    image_url: str,
    image_bytes: bytes,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """員工上傳 InBody 圖片，OCR 辨識後自動配對病患（限同 tenant）"""
    if user["role"] not in ("staff", "nutritionist", "admin"):
        raise HTTPException(403, "only staff can upload InBody records")

    try:
        ocr_result = await ocr_inbody(image_bytes)
    except Exception as e:
        pending = InbodyPending(
            tenant_id=user["tenant_id"],
            uploaded_by=user["user_id"],
            image_url=image_url,
            status="pending",
        )
        db.add(pending)
        await db.commit()
        return {"status": "pending", "reason": f"OCR failed: {e}"}

    ocr_name = ocr_result.get("name", "")
    ocr_birth = None
    if ocr_result.get("birth_date"):
        try:
            ocr_birth = date.fromisoformat(ocr_result["birth_date"])
        except ValueError:
            pass

    match = await match_patient(db, ocr_name, ocr_birth, tenant_id=user["tenant_id"])

    if match["status"] == "matched":
        record = InbodyRecord(
            patient_id=match["patient_id"],
            tenant_id=user["tenant_id"],
            uploaded_by=user["user_id"],
            measured_at=datetime.now(),
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
        return {"status": "matched", "patient_id": match["patient_id"]}

    pending = InbodyPending(
        tenant_id=user["tenant_id"],
        uploaded_by=user["user_id"],
        image_url=image_url,
        ocr_name=ocr_name,
        ocr_birth_date=ocr_birth,
        ocr_data=ocr_result,
        status=match["status"],
    )
    db.add(pending)
    await db.commit()
    return {"status": match["status"], "candidates": match["candidates"]}
