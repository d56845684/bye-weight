from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.visit import Visit, Medication

router = APIRouter(prefix="/visits", tags=["visits"])


@router.get("")
async def list_visits(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_id = user["patient_id"]
    stmt = (
        select(Visit)
        .where(Visit.patient_id == patient_id)
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


@router.get("/{visit_id}/medications")
async def list_medications(
    visit_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Medication).where(Medication.visit_id == visit_id)
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
