from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.notification import NotificationRule
from services.notification import run_daily_notifications
from utils.cache import invalidate

router = APIRouter(tags=["notifications"])


@router.get("/notification-rules")
async def list_rules(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_id = user["patient_id"]
    stmt = select(NotificationRule).where(NotificationRule.patient_id == patient_id)
    result = await db.execute(stmt)
    rules = result.scalars().all()
    return [
        {
            "id": r.id,
            "type": r.type,
            "days_before": r.days_before,
            "interval_days": r.interval_days,
            "send_time": r.send_time.isoformat() if r.send_time else None,
            "active": r.active,
        }
        for r in rules
    ]


@router.post("/notification-rules")
async def create_rule(
    type: str,
    days_before: int | None = None,
    interval_days: int | None = None,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = NotificationRule(
        patient_id=user["patient_id"],
        type=type,
        days_before=days_before,
        interval_days=interval_days,
    )
    db.add(rule)
    await db.commit()
    await invalidate(f"cache:notif_rules:{user['patient_id']}")
    return {"id": rule.id, "status": "created"}


@router.patch("/notification-rules/{rule_id}")
async def update_rule(
    rule_id: int,
    active: bool | None = None,
    days_before: int | None = None,
    interval_days: int | None = None,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    values = {}
    if active is not None:
        values["active"] = active
    if days_before is not None:
        values["days_before"] = days_before
    if interval_days is not None:
        values["interval_days"] = interval_days

    if not values:
        raise HTTPException(400, "no fields to update")

    await db.execute(
        update(NotificationRule)
        .where(NotificationRule.id == rule_id)
        .values(**values)
    )
    await db.commit()
    await invalidate(f"cache:notif_rules:{user['patient_id']}")
    return {"status": "updated"}


@router.post("/internal/notify/run")
async def trigger_notifications(db: AsyncSession = Depends(get_db)):
    """Cloud Scheduler 呼叫入口（不經過 JWT 驗證，由 OIDC token 保護）"""
    await run_daily_notifications(db)
    return {"status": "done"}
