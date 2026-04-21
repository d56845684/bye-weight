from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user, current_patient
from models.patient import Patient
from models.visit import Visit, Medication
from schemas.visit import VisitTimelineItem

router = APIRouter(prefix="/visits", tags=["visits"])


@router.get("")
async def list_visits(
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Visit)
        .where(
            Visit.patient_id == patient.id,
            Visit.tenant_id == user["tenant_id"],
        )
        .order_by(Visit.visit_date.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    visits = result.scalars().all()
    return [
        {
            "id": v.id,
            "visit_date": v.visit_date.isoformat(),
            "doctor_id": v.doctor_id,
            "notes": v.notes,
            "next_visit_date": v.next_visit_date.isoformat() if v.next_visit_date else None,
        }
        for v in visits
    ]


@router.get("/me/timeline", response_model=list[VisitTimelineItem])
async def visits_timeline(
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    """病患 dashboard 看診紀錄：依 next_visit_date 標記 upcoming + 距今天數。
    排序：upcoming 先（依最近日期），其他依 visit_date desc。"""
    stmt = (
        select(Visit)
        .where(
            Visit.patient_id == patient.id,
            Visit.tenant_id == user["tenant_id"],
            Visit.deleted_at.is_(None),
        )
        .order_by(Visit.visit_date.desc())
        .limit(100)
    )
    visits = (await db.execute(stmt)).scalars().all()

    today = date.today()
    items = [
        VisitTimelineItem(
            id=v.id,
            visit_date=v.visit_date,
            next_visit_date=v.next_visit_date,
            doctor_id=v.doctor_id,
            notes=v.notes,
            upcoming=(v.next_visit_date is not None and v.next_visit_date >= today),
            days_away=((v.next_visit_date - today).days
                       if v.next_visit_date is not None and v.next_visit_date >= today else None),
            created_at=v.created_at,
        )
        for v in visits
    ]
    # upcoming 先（最近的在最前面）；其他維持既有 visit_date desc
    items.sort(key=lambda x: (
        0 if x.upcoming else 1,
        x.days_away if x.upcoming and x.days_away is not None else 0,
        -x.visit_date.toordinal(),
    ))
    return items


@router.get("/{visit_id}/medications")
async def list_medications(
    visit_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    # tenant 過濾：medications 透過 tenant_id 直接濾（auth layer 已保證 resource 歸屬）
    stmt = select(Medication).where(
        Medication.visit_id == visit_id,
        Medication.tenant_id == user["tenant_id"],
    )
    result = await db.execute(stmt)
    meds = result.scalars().all()
    return [
        {
            "id": m.id,
            "drug_name": m.drug_name,
            "frequency": m.frequency,
            "days": m.days,
            "start_date": m.start_date.isoformat() if m.start_date else None,
            "end_date": m.end_date.isoformat() if m.end_date else None,
        }
        for m in meds
    ]
