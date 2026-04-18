from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.patient import Patient, LineBinding

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("")
async def list_patients(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出同 tenant 的 patients（auth_service 已擋非 admin/staff）"""
    stmt = (
        select(Patient)
        .where(Patient.tenant_id == user["tenant_id"])
        .order_by(Patient.id.desc())
        .limit(200)
    )
    result = await db.execute(stmt)
    patients = result.scalars().all()
    return {
        "patients": [
            {
                "id": p.id,
                "auth_user_id": p.auth_user_id,
                "tenant_id": p.tenant_id,
                "name": p.name,
                "sex": p.sex,
                "birth_date": p.birth_date.isoformat() if p.birth_date else None,
                "phone": p.phone,
                "email": p.email,
            }
            for p in patients
        ]
    }


@router.get("/{patient_id}")
async def get_patient(
    patient_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Patient).where(
        Patient.id == patient_id,
        Patient.tenant_id == user["tenant_id"],
    )
    result = await db.execute(stmt)
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "patient not found")
    return {
        "id": patient.id,
        "auth_user_id": patient.auth_user_id,
        "tenant_id": patient.tenant_id,
        "name": patient.name,
        "sex": patient.sex,
        "birth_date": patient.birth_date.isoformat(),
        "phone": patient.phone,
        "email": patient.email,
    }


@router.post("/bind")
async def bind_line(
    patient_id: int,
    auth_user_id: int,
    line_uuid: str,
    clinic_id: str | None = None,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """綁定 LINE 帳號、auth user 與病患 profile。
    必須同 tenant：auth_user_id 對應的 user 必須跟 patient 在同一 tenant。"""
    patient = (await db.execute(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.tenant_id == user["tenant_id"],
        )
    )).scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "patient not found in current tenant")

    patient.auth_user_id = auth_user_id
    binding = LineBinding(
        patient_id=patient_id,
        tenant_id=user["tenant_id"],
        clinic_id=clinic_id,
        line_uuid=line_uuid,
    )
    db.add(binding)
    await db.commit()
    return {"status": "bound", "patient_id": patient_id, "auth_user_id": auth_user_id}
