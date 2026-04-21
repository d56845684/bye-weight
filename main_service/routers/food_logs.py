from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user, current_patient
from models.food_log import FoodLog
from models.patient import Patient, PatientGoal
from schemas.food_log import FoodLogItem, FoodLogSummary, MacroPct
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


@router.get("/me/summary", response_model=FoodLogSummary)
async def food_log_summary(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    """病患 dashboard 一站式：今日餐點 + N 天 kcal / macros 序列。

    設計決策：
      - `target_kcal` 目前 schema 沒這欄，回 None；前端 fallback 到 placeholder。
      - 同一天多餐 aggregate 成一筆（kcal sum、macros 依 kcal 加權平均）。
      - 沒有紀錄的日子 kcal=None、macros=None —— 前端畫圖時可直接跳過或畫斷點。
    """
    today = date.today()
    start = today - timedelta(days=days - 1)

    stmt = (
        select(FoodLog)
        .where(
            FoodLog.patient_id == patient.id,
            FoodLog.tenant_id == user["tenant_id"],
            FoodLog.deleted_at.is_(None),
            FoodLog.logged_at >= datetime.combine(start, datetime.min.time()),
        )
        .order_by(FoodLog.logged_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()

    # 「當前目標」= 最新一筆 effective_from <= today 的 patient_goals row。
    # patient_goals 歷史 append-only，新的就蓋掉舊的邏輯上 = 查 LIMIT 1。
    goal_stmt = (
        select(PatientGoal)
        .where(
            PatientGoal.patient_id == patient.id,
            PatientGoal.tenant_id == user["tenant_id"],
            PatientGoal.deleted_at.is_(None),
            PatientGoal.effective_from <= today,
        )
        .order_by(PatientGoal.effective_from.desc())
        .limit(1)
    )
    current_goal = (await db.execute(goal_stmt)).scalar_one_or_none()

    # 以日期聚合
    by_day: dict[date, list[FoodLog]] = defaultdict(list)
    for r in rows:
        by_day[r.logged_at.date()].append(r)

    dates: list[str] = []
    kcal_series: list[float | None] = []
    macros_series: list[MacroPct | None] = []

    # 整區間平均
    sum_c = sum_p = sum_f = 0.0
    non_null_days = 0

    d = start
    while d <= today:
        dates.append(d.isoformat())
        logs = by_day.get(d, [])
        if not logs:
            kcal_series.append(None)
            macros_series.append(None)
        else:
            total_kcal = sum(float(l.total_calories or 0) for l in logs)
            total_c = sum(float(l.total_carbs or 0) for l in logs)
            total_p = sum(float(l.total_protein or 0) for l in logs)
            total_f = sum(float(l.total_fat or 0) for l in logs)
            kcal_series.append(round(total_kcal, 1))
            denom = total_c + total_p + total_f
            if denom > 0:
                c_pct = round(total_c / denom * 100, 1)
                p_pct = round(total_p / denom * 100, 1)
                f_pct = round(total_f / denom * 100, 1)
                macros_series.append(MacroPct(carbs=c_pct, protein=p_pct, fat=f_pct))
                sum_c += c_pct
                sum_p += p_pct
                sum_f += f_pct
                non_null_days += 1
            else:
                macros_series.append(None)
        d += timedelta(days=1)

    today_logs = by_day.get(today, [])
    today_kcal = sum(float(l.total_calories or 0) for l in today_logs)
    today_meals = [
        FoodLogItem(
            id=l.id,
            logged_at=l.logged_at,
            meal_type=l.meal_type,
            image_url=l.image_url,
            food_items=l.food_items if isinstance(l.food_items, list) else None,
            total_calories=float(l.total_calories) if l.total_calories is not None else None,
            total_protein=float(l.total_protein) if l.total_protein is not None else None,
            total_carbs=float(l.total_carbs) if l.total_carbs is not None else None,
            total_fat=float(l.total_fat) if l.total_fat is not None else None,
            ai_suggestion=l.ai_suggestion,
        )
        for l in today_logs
    ]

    macros_avg: MacroPct | None = None
    if non_null_days > 0:
        macros_avg = MacroPct(
            carbs=round(sum_c / non_null_days, 1),
            protein=round(sum_p / non_null_days, 1),
            fat=round(sum_f / non_null_days, 1),
        )

    target_macros: MacroPct | None = None
    if current_goal and (
        current_goal.target_carbs_pct is not None
        or current_goal.target_protein_pct is not None
        or current_goal.target_fat_pct is not None
    ):
        target_macros = MacroPct(
            carbs=float(current_goal.target_carbs_pct or 0),
            protein=float(current_goal.target_protein_pct or 0),
            fat=float(current_goal.target_fat_pct or 0),
        )

    return FoodLogSummary(
        target_kcal=current_goal.daily_kcal if current_goal else None,
        target_macros=target_macros,
        today_kcal=round(today_kcal, 1),
        today_meals=today_meals,
        dates=dates,
        kcal_series=kcal_series,
        macros_series=macros_series,
        macros_avg=macros_avg,
    )


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
