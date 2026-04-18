from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.patient import Patient


async def current_user(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    x_tenant_id: str = Header(...),
):
    """Nginx auth_request 通過後注入的 identity header。
    不再有 clinic_id / patient_id；領域層面由各 router 自行解析。"""
    return {
        "user_id": int(x_user_id),
        "role": x_user_role,
        "tenant_id": int(x_tenant_id),
    }


async def current_patient(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Patient:
    """從 auth_user_id 解析出當前 user 的 patient profile（僅 role=patient 用）。
    同時驗證 tenant_id 一致，防止跨租戶存取。"""
    stmt = select(Patient).where(
        Patient.auth_user_id == user["user_id"],
        Patient.tenant_id == user["tenant_id"],
    )
    result = await db.execute(stmt)
    patient = result.scalar_one_or_none()
    if patient is None:
        raise HTTPException(404, "patient profile not found for current user")
    return patient
