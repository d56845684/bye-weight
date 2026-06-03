"""LINE 食物照片攝取流程：upload GCS → recognize_food → 個人化建議 → 寫入 food_logs。

供 LINE webhook（patient 傳照片）使用。Caller 已驗 signature、查 sender，
本 service 假設傳進來的 sender 一定是 patient role。

回傳 dict 給 webhook layer 決定 reply 文字：
  {"status": "logged", "patient_name": str, "food_names": list[str], ...}
  {"status": "no_profile"}   # auth_user 沒對應 patient profile
  {"status": "ocr_failed", "reason": str}
"""
import logging
import os
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.food_log import FoodLog
from models.food_log_image import FoodLogImage
from models.patient import Patient, PatientGoal
from services.food_advice import generate_advice
from services.ocr import recognize_food
from utils.cache import invalidate

log = logging.getLogger(__name__)

GCS_BUCKET = os.getenv("GCS_BUCKET_NAME", "")

# 餐別判斷用台灣時間。container 跑 UTC，直接 datetime.now() 會把傍晚餐算成早餐。
# 台灣無日光節約，固定 +8 offset 即可（也免依賴 slim image 可能缺的 tzdata）。
TAIPEI_TZ = timezone(timedelta(hours=8))


async def ingest_food(
    db: AsyncSession,
    *,
    sender_user_id: int,
    tenant_id: int,
    image_bytes: bytes,
) -> dict:
    # 1. auth user → patient profile
    patient = (await db.execute(
        select(Patient).where(
            Patient.auth_user_id == sender_user_id,
            Patient.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not patient:
        return {"status": "no_profile"}

    # 2. 上傳到 GCS（同 routers.upload 的 blob path 慣例）
    stamp = f"{datetime.now():%Y%m%d_%H%M%S}_{secrets.token_hex(3)}"
    blob_path = f"food/t{tenant_id}/p{patient.id}/{stamp}.jpg"
    try:
        await _upload_to_gcs(blob_path, image_bytes)
    except Exception as e:
        log.warning("food image GCS upload failed: %s", e)
        return {"status": "upload_failed", "reason": str(e)}

    # 3. AI 辨識（失敗不擋 — 仍記錄圖片讓人工後補）
    try:
        ocr = await recognize_food(image_bytes)
    except Exception as e:
        log.warning("recognize_food failed: %s", e)
        await _persist_image_only(db, patient_id=patient.id, tenant_id=tenant_id, blob_path=blob_path)
        return {"status": "ocr_failed", "reason": str(e), "patient_name": patient.name}

    # 4. 今天截至目前累計（不含這餐）+ 當前 goal
    today_totals = await _today_totals(db, patient.id, tenant_id)
    goal = await _current_goal(db, patient.id, tenant_id)

    advice = await generate_advice(meal=ocr, today_totals=today_totals, goal=goal)

    # 5. 寫 food_log + 圖片
    flog = FoodLog(
        patient_id=patient.id,
        tenant_id=tenant_id,
        logged_at=datetime.now(),
        meal_type=_meal_type_for_now(),
        food_items=ocr.get("food_items"),
        total_calories=ocr.get("total_calories"),
        total_protein=ocr.get("total_protein"),
        total_carbs=ocr.get("total_carbs"),
        total_fat=ocr.get("total_fat"),
        ai_suggestion=advice["advice"],
    )
    db.add(flog)
    await db.flush()

    db.add(FoodLogImage(
        food_log_id=flog.id,
        tenant_id=tenant_id,
        blob_path=blob_path,
        position=0,
        ai_analysis=ocr,
    ))
    await db.commit()
    await invalidate(f"cache:food:{patient.id}:{date.today().isoformat()}")

    return {
        "status": "logged",
        "patient_name": patient.name,
        "food_names": [f["name"] for f in (ocr.get("food_items") or []) if f.get("name")],
        "kcal": ocr.get("total_calories"),
        "protein": ocr.get("total_protein"),
        "carbs": ocr.get("total_carbs"),
        "fat": ocr.get("total_fat"),
        "advice": advice["advice"],
        "traffic_light": advice["traffic_light"],
        "remaining_kcal": advice["remaining_kcal"],
    }


def _meal_type_for_now() -> str:
    """以台灣時間粗分餐別。讓 patient 不用自己選；事後可在 LIFF 修改。"""
    h = datetime.now(TAIPEI_TZ).hour
    if 5 <= h < 10:
        return "breakfast"
    if 10 <= h < 14:
        return "lunch"
    if 14 <= h < 17:
        return "snack"
    if 17 <= h < 21:
        return "dinner"
    return "snack"


async def _today_totals(db: AsyncSession, patient_id: int, tenant_id: int) -> dict:
    """今天截至目前已累計（不含這餐）。沒紀錄就回 0。"""
    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = datetime.combine(today + timedelta(days=1), datetime.min.time())
    rows = (await db.execute(
        select(FoodLog).where(
            FoodLog.patient_id == patient_id,
            FoodLog.tenant_id == tenant_id,
            FoodLog.deleted_at.is_(None),
            FoodLog.logged_at >= start,
            FoodLog.logged_at < end,
        )
    )).scalars().all()
    return {
        "kcal":    sum(float(r.total_calories or 0) for r in rows),
        "protein": sum(float(r.total_protein or 0) for r in rows),
        "carbs":   sum(float(r.total_carbs or 0)   for r in rows),
        "fat":     sum(float(r.total_fat or 0)     for r in rows),
    }


async def _current_goal(db: AsyncSession, patient_id: int, tenant_id: int) -> dict | None:
    g = (await db.execute(
        select(PatientGoal).where(
            PatientGoal.patient_id == patient_id,
            PatientGoal.tenant_id == tenant_id,
            PatientGoal.deleted_at.is_(None),
            PatientGoal.effective_from <= date.today(),
        ).order_by(PatientGoal.effective_from.desc()).limit(1)
    )).scalar_one_or_none()
    if not g:
        return None
    return {
        "daily_kcal": g.daily_kcal,
        "target_carbs_pct":   float(g.target_carbs_pct)   if g.target_carbs_pct   is not None else None,
        "target_protein_pct": float(g.target_protein_pct) if g.target_protein_pct is not None else None,
        "target_fat_pct":     float(g.target_fat_pct)     if g.target_fat_pct     is not None else None,
        "target_weight":      float(g.target_weight)      if g.target_weight      is not None else None,
    }


async def _persist_image_only(
    db: AsyncSession, *, patient_id: int, tenant_id: int, blob_path: str
) -> None:
    """OCR 失敗時還是要留紀錄：開一筆 nutrition 全空的 food_log + 1 張圖，
    讓 staff 後台可以人工補上。"""
    flog = FoodLog(
        patient_id=patient_id,
        tenant_id=tenant_id,
        logged_at=datetime.now(),
        meal_type=_meal_type_for_now(),
    )
    db.add(flog)
    await db.flush()  # 拿 flog.id 才能 FK
    db.add(FoodLogImage(
        food_log_id=flog.id,
        tenant_id=tenant_id,
        blob_path=blob_path,
        position=0,
    ))
    await db.commit()


async def _upload_to_gcs(blob_path: str, image_bytes: bytes) -> None:
    """同步 google-cloud-storage call 放進 thread。test 可 monkeypatch 整支。
    bucket env var 沒設 → 跳過上傳（dev / CI 場景）。"""
    if not GCS_BUCKET:
        log.info("GCS_BUCKET_NAME not set; skipping upload of %s", blob_path)
        return
    import asyncio

    from google.cloud import storage

    def _do():
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(image_bytes, content_type="image/jpeg")

    await asyncio.to_thread(_do)
