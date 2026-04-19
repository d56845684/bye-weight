from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.patient import Patient, LineBinding
from schemas.patient import (
    PatientCreateRequest,
    PatientOut,
    PatientRegisterRequest,
    PatientUpdateRequest,
)

router = APIRouter(prefix="/patients", tags=["patients"])


def _to_out(p: Patient) -> dict:
    return {
        "id": p.id,
        "auth_user_id": p.auth_user_id,
        "tenant_id": p.tenant_id,
        "name": p.name,
        "sex": p.sex,
        "birth_date": p.birth_date.isoformat() if p.birth_date else None,
        "phone": p.phone,
        "email": p.email,
        "national_id": p.national_id,
        "address": p.address,
    }


@router.get("")
async def list_patients(
    q: str | None = Query(None, description="名字模糊搜尋"),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出同 tenant 未被軟刪除的 patients。IAM policy 已擋非 read 權限角色。"""
    stmt = (
        select(Patient)
        .where(
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
        .order_by(Patient.id.desc())
        .limit(200)
    )
    if q:
        stmt = stmt.where(Patient.name.ilike(f"%{q}%"))
    result = await db.execute(stmt)
    patients = result.scalars().all()
    return {"patients": [_to_out(p) for p in patients]}


@router.get("/me", response_model=PatientOut)
async def get_my_patient(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """回傳當前 LIFF 使用者的 patient profile；尚未 register 就 404。
    LIFF 首次登入用來判斷是否要導去 /patient/register。"""
    stmt = select(Patient).where(
        Patient.auth_user_id == user["user_id"],
        Patient.tenant_id == user["tenant_id"],
        Patient.deleted_at.is_(None),
    )
    patient = (await db.execute(stmt)).scalar_one_or_none()
    if patient is None:
        raise HTTPException(404, "patient profile not found")
    return _to_out(patient)


@router.post("/register", response_model=PatientOut, status_code=201)
async def register_patient(
    payload: PatientRegisterRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """LIFF 首次登入時，讓 role=patient 的使用者自己建立 patient profile。
    一次性：已登記過會回 409；同 tenant 內 national_id 重複也 409。"""
    existing = (await db.execute(
        select(Patient).where(
            Patient.auth_user_id == user["user_id"],
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "patient profile already registered")

    patient = Patient(
        auth_user_id=user["user_id"],
        tenant_id=user["tenant_id"],
        name=payload.name,
        sex=payload.sex,
        birth_date=payload.birth_date,
        phone=payload.phone,
        national_id=payload.national_id,
        address=payload.address,
    )
    db.add(patient)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(409, "national_id or auth_user_id already exists in this tenant") from e

    return {
        "id": patient.id,
        "auth_user_id": user["user_id"],
        "tenant_id": user["tenant_id"],
        "name": payload.name,
        "sex": payload.sex,
        "birth_date": payload.birth_date.isoformat(),
        "phone": payload.phone,
        "email": None,
        "national_id": payload.national_id,
        "address": payload.address,
    }


@router.post("", response_model=PatientOut, status_code=201)
async def create_patient(
    payload: PatientCreateRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """管理端建立病患（admin / staff）。
    可選 auth_user_id：搭配 /auth/admin/users/invite 的兩段式邀請流程使用。"""
    patient = Patient(
        tenant_id=user["tenant_id"],
        auth_user_id=payload.auth_user_id,
        name=payload.name,
        sex=payload.sex,
        birth_date=payload.birth_date,
        phone=payload.phone,
        email=payload.email,
        national_id=payload.national_id,
        address=payload.address,
    )
    db.add(patient)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(409, "national_id already exists in this tenant") from e
    return _to_out(patient)


@router.get("/{patient_id}", response_model=PatientOut)
async def get_patient(
    patient_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Patient).where(
        Patient.id == patient_id,
        Patient.tenant_id == user["tenant_id"],
        Patient.deleted_at.is_(None),
    )
    patient = (await db.execute(stmt)).scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "patient not found")
    return _to_out(patient)


@router.patch("/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: int,
    payload: PatientUpdateRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    patient = (await db.execute(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "patient not found")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(patient, field, value)

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(409, "unique constraint violation: "+str(e)) from e
    return _to_out(patient)


@router.delete("/{patient_id}")
async def delete_patient(
    patient_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """軟刪除：set deleted_at/by、不真正移除 row。後續 list/get 都會過濾掉。"""
    result = await db.execute(
        update(Patient)
        .where(
            Patient.id == patient_id,
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
        .values(deleted_at=datetime.utcnow(), deleted_by=user["user_id"])
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "patient not found")
    return {"status": "deleted", "id": patient_id}


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
            Patient.deleted_at.is_(None),
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
