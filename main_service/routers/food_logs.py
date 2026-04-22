from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from deps import current_user, current_patient
from models.food_log import FoodLog
from models.food_log_image import FoodLogImage
from models.patient import Patient, PatientGoal
from schemas.food_log import (
    FoodLogAdminItem,
    FoodLogCreateRequest,
    FoodLogImageItem,
    FoodLogItem,
    FoodLogSummary,
    MacroPct,
)
from utils.cache import invalidate

router = APIRouter(prefix="/food-logs", tags=["food-logs"])


def _images_payload(log: FoodLog) -> list[FoodLogImageItem]:
    """把 eagerly-loaded 的 log.images 收斂成 API 回傳格式；soft-deleted 過濾掉。"""
    return [
        FoodLogImageItem(
            id=img.id,
            blob_path=img.blob_path,
            position=img.position,
            caption=img.caption,
        )
        for img in log.images
        if img.deleted_at is None
    ]


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
        .options(selectinload(FoodLog.images))
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
            "images": [img.model_dump() for img in _images_payload(log)],
            "food_items": log.food_items,
            "total_calories": float(log.total_calories) if log.total_calories else None,
            "total_protein": float(log.total_protein) if log.total_protein else None,
            "total_carbs": float(log.total_carbs) if log.total_carbs else None,
            "total_fat": float(log.total_fat) if log.total_fat else None,
            "ai_suggestion": log.ai_suggestion,
        }
        for log in logs
    ]


@router.get("/records", response_model=list[FoodLogAdminItem])
async def list_records(
    patient_id: int | None = Query(None, description="過濾單一病患"),
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin tenant-wide 飲食紀錄列表。JOIN patients 帶姓名 + 病歷號。
    - 病患走 /food-logs/me/summary，不吃這支；IAM resource 已擋下。
    - 不回完整 images list，只回 image_count + primary_image_path，避免列表頁 payload 爆炸。"""
    since = datetime.combine(date.today() - timedelta(days=days - 1), datetime.min.time())
    stmt = (
        select(FoodLog, Patient.name, Patient.chart_no)
        .join(Patient, Patient.id == FoodLog.patient_id, isouter=True)
        .where(
            FoodLog.tenant_id == user["tenant_id"],
            FoodLog.deleted_at.is_(None),
            FoodLog.logged_at >= since,
        )
    )
    if patient_id is not None:
        stmt = stmt.where(FoodLog.patient_id == patient_id)
    stmt = stmt.order_by(FoodLog.logged_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()

    food_log_ids = [f.id for f, _, _ in rows]
    # 一支 aggregate SQL 拿 (count, position=0 / 最小 position 當 primary)
    # 免得為了 image_count 在 ORM 踩 N+1。
    img_stats: dict[int, tuple[int, str | None]] = {}
    if food_log_ids:
        img_rows = (await db.execute(
            select(
                FoodLogImage.food_log_id,
                FoodLogImage.blob_path,
                FoodLogImage.position,
            )
            .where(
                FoodLogImage.food_log_id.in_(food_log_ids),
                FoodLogImage.tenant_id == user["tenant_id"],
                FoodLogImage.deleted_at.is_(None),
            )
            .order_by(FoodLogImage.food_log_id, FoodLogImage.position)
        )).all()
        bucket: dict[int, list[str]] = defaultdict(list)
        for log_id, blob_path, _pos in img_rows:
            bucket[log_id].append(blob_path)
        img_stats = {lid: (len(paths), paths[0]) for lid, paths in bucket.items()}

    return [
        FoodLogAdminItem(
            id=f.id,
            patient_id=f.patient_id,
            patient_name=pn,
            chart_no=pc,
            logged_at=f.logged_at,
            meal_type=f.meal_type,
            image_count=img_stats.get(f.id, (0, None))[0],
            primary_image_path=img_stats.get(f.id, (0, None))[1],
            total_calories=float(f.total_calories) if f.total_calories is not None else None,
            total_protein=float(f.total_protein) if f.total_protein is not None else None,
            total_carbs=float(f.total_carbs) if f.total_carbs is not None else None,
            total_fat=float(f.total_fat) if f.total_fat is not None else None,
            ai_suggestion=f.ai_suggestion,
        )
        for f, pn, pc in rows
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
        .options(selectinload(FoodLog.images))
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
            images=_images_payload(l),
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
    body: FoodLogCreateRequest,
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    """建立一筆飲食紀錄，附 0..N 張圖。
    image_paths 是 `/upload/presigned-url` 回來、client 已實際 PUT 上去的 GCS
    blob path，server 依 list 順序當 position（0 = primary）。"""
    log = FoodLog(
        patient_id=patient.id,
        tenant_id=user["tenant_id"],
        logged_at=datetime.now(),
        meal_type=body.meal_type,
        food_items=body.food_items,
        total_calories=body.total_calories,
        total_protein=body.total_protein,
        total_carbs=body.total_carbs,
        total_fat=body.total_fat,
        ai_suggestion=body.ai_suggestion,
    )
    db.add(log)
    await db.flush()  # 先拿 log.id 才能給 images 當 FK

    for idx, blob_path in enumerate(body.image_paths):
        blob_path = (blob_path or "").strip()
        if not blob_path:
            continue
        db.add(FoodLogImage(
            food_log_id=log.id,
            tenant_id=user["tenant_id"],
            blob_path=blob_path,
            position=idx,
        ))

    await db.commit()
    today = datetime.now().strftime("%Y-%m-%d")
    await invalidate(f"cache:food:{patient.id}:{today}")
    return {"id": log.id, "status": "created", "image_count": len(body.image_paths)}
