"""InBody API — 目前只提供病患 LIFF 讀歷史紀錄的 GET。

員工上傳 InBody 的入口改走 LINE OA webhook（routers/line_webhook.py
→ services/inbody_ingest.py），所以這裡不再保留 HTTP POST upload
endpoint。之後若 admin 後台需要手動補上傳，再加一支 multipart
UploadFile 版本、共用 services.inbody_ingest.ingest_inbody。
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_patient, current_user
from models.inbody import InbodyRecord
from models.patient import Patient

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
