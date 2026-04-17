from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.patient import Patient

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("/{patient_id}")
async def get_patient(
    patient_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    # RBAC 已由 auth_service 檢查，這裡只做資料查詢
    stmt = select(Patient).where(Patient.id == patient_id)
    result = await db.execute(stmt)
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "patient not found")
    return {
        "id": patient.id,
        "name": patient.name,
        "sex": patient.sex,
        "birth_date": patient.birth_date.isoformat(),
        "phone": patient.phone,
        "email": patient.email,
    }


@router.post("/bind")
async def bind_line(
    patient_id: int,
    line_uuid: str,
    clinic_id: str,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """綁定 LINE 帳號與病患"""
    from models.patient import LineBinding

    binding = LineBinding(
        patient_id=patient_id,
        line_uuid=line_uuid,
        clinic_id=clinic_id,
    )
    db.add(binding)
    await db.commit()
    return {"status": "bound", "patient_id": patient_id}
