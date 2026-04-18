from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user, current_patient
from models.food_log import FoodLog
from models.patient import Patient
from utils.cache import invalidate

router = APIRouter(prefix="/food-logs", tags=["food-logs"])


@router.get("")
async def list_food_logs(
    date_from: str = Query(None),
    date_to: str = Query(None),
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(FoodLog)
        .where(
            FoodLog.patient_id == patient.id,
            FoodLog.tenant_id == user["tenant_id"],
        )
        .order_by(FoodLog.logged_at.desc())
        .limit(100)
    )
    if date_from:
        stmt = stmt.where(FoodLog.logged_at >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(FoodLog.logged_at <= datetime.fromisoformat(date_to))

    result = await db.execute(stmt)
    logs = result.scalars().all()
    return [
        {
            "id": log.id,
            "logged_at": log.logged_at.isoformat(),
            "meal_type": log.meal_type,
            "image_url": log.image_url,
            "food_items": log.food_items,
            "total_calories": float(log.total_calories) if log.total_calories else None,
            "total_protein": float(log.total_protein) if log.total_protein else None,
            "total_carbs": float(log.total_carbs) if log.total_carbs else None,
            "total_fat": float(log.total_fat) if log.total_fat else None,
            "ai_suggestion": log.ai_suggestion,
        }
        for log in logs
    ]


@router.post("")
async def create_food_log(
    meal_type: str,
    image_url: str | None = None,
    food_items: dict | None = None,
    total_calories: float | None = None,
    total_protein: float | None = None,
    total_carbs: float | None = None,
    total_fat: float | None = None,
    ai_suggestion: str | None = None,
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    log = FoodLog(
        patient_id=patient.id,
        tenant_id=user["tenant_id"],
        logged_at=datetime.now(),
        meal_type=meal_type,
        image_url=image_url,
        food_items=food_items,
        total_calories=total_calories,
        total_protein=total_protein,
        total_carbs=total_carbs,
        total_fat=total_fat,
        ai_suggestion=ai_suggestion,
    )
    db.add(log)
    await db.commit()
    today = datetime.now().strftime("%Y-%m-%d")
    await invalidate(f"cache:food:{patient.id}:{today}")
    return {"id": log.id, "status": "created"}
