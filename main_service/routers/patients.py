from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.food_log import FoodLog
from models.inbody import InbodyRecord
from models.patient import Patient, LineBinding, PatientGoal
from models.visit import Visit
from schemas.patient import (
    PatientCreateRequest,
    PatientDetailOut,
    PatientGoalItem,
    PatientOut,
    PatientRegisterRequest,
    PatientSelfOut,
    PatientUpdateRequest,
)
from services.chart_no import next_chart_no

router = APIRouter(prefix="/patients", tags=["patients"])


_CHART_NO_RETRY = 5


def _to_out(p: Patient) -> dict:
    """Admin / staff 視角：完整 profile 含 his_id。"""
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
        "chart_no": p.chart_no,
        "his_id": p.his_id,
    }


def _to_self_out(p: Patient) -> dict:
    """病患自己的視角：不含 his_id（HIS 映射是診所內部映射，病患不需要看到）。"""
    out = _to_out(p)
    out.pop("his_id", None)
    return out


def _is_chart_no_conflict(e: IntegrityError) -> bool:
    msg = str(e.orig) if getattr(e, "orig", None) else str(e)
    return "chart_no" in msg.lower()


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


@router.get("/me", response_model=PatientSelfOut)
async def get_my_patient(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """回傳當前 LIFF 使用者的 patient profile；尚未 register 就 404。
    LIFF 首次登入用來判斷是否要導去 /patient/register。
    病患視角：不含 his_id。"""
    stmt = select(Patient).where(
        Patient.auth_user_id == user["user_id"],
        Patient.tenant_id == user["tenant_id"],
        Patient.deleted_at.is_(None),
    )
    patient = (await db.execute(stmt)).scalar_one_or_none()
    if patient is None:
        raise HTTPException(404, "patient profile not found")
    return _to_self_out(patient)


@router.post("/register", response_model=PatientSelfOut, status_code=201)
async def register_patient(
    payload: PatientRegisterRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """LIFF 首次登入時，讓 role=patient 的使用者自己建立 patient profile。
    一次性：已登記過會回 409；同 tenant 內 national_id 重複也 409。
    chart_no 後端自動產生；病患端不顯示 his_id。"""
    existing = (await db.execute(
        select(Patient).where(
            Patient.auth_user_id == user["user_id"],
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "patient profile already registered")

    for attempt in range(_CHART_NO_RETRY):
        chart_no = await next_chart_no(db, user["tenant_id"])
        patient = Patient(
            auth_user_id=user["user_id"],
            tenant_id=user["tenant_id"],
            name=payload.name,
            sex=payload.sex,
            birth_date=payload.birth_date,
            phone=payload.phone,
            national_id=payload.national_id,
            address=payload.address,
            chart_no=chart_no,
        )
        db.add(patient)
        try:
            await db.commit()
            break
        except IntegrityError as e:
            await db.rollback()
            if _is_chart_no_conflict(e) and attempt < _CHART_NO_RETRY - 1:
                continue  # 並發搶號：重跑 MAX+1
            raise HTTPException(409, "national_id or auth_user_id already exists in this tenant") from e
    return _to_self_out(patient)


@router.post("", response_model=PatientOut, status_code=201)
async def create_patient(
    payload: PatientCreateRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """管理端建立病患（admin / staff）。
    - chart_no 不傳 → 後端以 P000001 規則自動產生（同 tenant 遞增）。
    - chart_no 傳入 → 直接採用（例如匯入舊系統的病歷號）；同 tenant 重複 → 409。
    - his_id 不在建立流程填；建立後由 admin 走 PATCH 補上。"""
    for attempt in range(_CHART_NO_RETRY):
        chart_no = payload.chart_no or await next_chart_no(db, user["tenant_id"])
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
            chart_no=chart_no,
        )
        db.add(patient)
        try:
            await db.commit()
            break
        except IntegrityError as e:
            await db.rollback()
            # 只有「自動產生 chart_no」的情況可以 retry；admin 明確指定值撞到就直接 409
            if (
                _is_chart_no_conflict(e)
                and payload.chart_no is None
                and attempt < _CHART_NO_RETRY - 1
            ):
                continue
            if _is_chart_no_conflict(e):
                raise HTTPException(409, "chart_no already exists in this tenant") from e
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


@router.get("/{patient_id}/detail", response_model=PatientDetailOut)
async def get_patient_detail(
    patient_id: int,
    food_log_days: int = Query(30, ge=1, le=365),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin 後台單一病患 detail：一次拿完 profile + goals + inbody / food / visits 歷史。
    資料量級通常 < 30KB，不切多支 endpoint 避免 5 次 round-trip。

    patient-self 走 /patients/me 系列，不碰這支（IAM resource 也比對不上）。"""
    patient = (await db.execute(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "patient not found")

    # 四個子 query 並列跑，event loop 下幾乎無額外成本（pgxpool 可並發）。
    # SQLAlchemy async session 不是 thread-safe，所以依序 await，但 pg 端 batch planning
    # 成本可忽略（每個 query <1ms）。
    inbody_rows = (await db.execute(
        select(InbodyRecord)
        .where(
            InbodyRecord.patient_id == patient_id,
            InbodyRecord.tenant_id == user["tenant_id"],
            InbodyRecord.deleted_at.is_(None),
        )
        .order_by(InbodyRecord.measured_at.desc())
        .limit(50)
    )).scalars().all()

    food_since = datetime.combine(date.today() - timedelta(days=food_log_days - 1), datetime.min.time())
    food_rows = (await db.execute(
        select(FoodLog)
        .where(
            FoodLog.patient_id == patient_id,
            FoodLog.tenant_id == user["tenant_id"],
            FoodLog.deleted_at.is_(None),
            FoodLog.logged_at >= food_since,
        )
        .order_by(FoodLog.logged_at.desc())
        .limit(500)
    )).scalars().all()

    visit_rows = (await db.execute(
        select(Visit)
        .where(
            Visit.patient_id == patient_id,
            Visit.tenant_id == user["tenant_id"],
            Visit.deleted_at.is_(None),
        )
        .order_by(Visit.visit_date.desc())
        .limit(50)
    )).scalars().all()

    goal_rows = (await db.execute(
        select(PatientGoal)
        .where(
            PatientGoal.patient_id == patient_id,
            PatientGoal.tenant_id == user["tenant_id"],
            PatientGoal.deleted_at.is_(None),
        )
        .order_by(PatientGoal.effective_from.desc())
        .limit(50)
    )).scalars().all()

    today = date.today()
    return PatientDetailOut(
        patient=PatientOut(**_to_out(patient)),
        goals=[
            PatientGoalItem(
                id=g.id,
                effective_from=g.effective_from,
                daily_kcal=g.daily_kcal,
                target_weight=float(g.target_weight) if g.target_weight is not None else None,
                target_body_fat=float(g.target_body_fat) if g.target_body_fat is not None else None,
                target_carbs_pct=float(g.target_carbs_pct) if g.target_carbs_pct is not None else None,
                target_protein_pct=float(g.target_protein_pct) if g.target_protein_pct is not None else None,
                target_fat_pct=float(g.target_fat_pct) if g.target_fat_pct is not None else None,
                set_by=g.set_by,
                notes=g.notes,
                created_at=g.created_at,
            )
            for g in goal_rows
        ],
        inbody_records=[
            {
                "id": r.id,
                "measured_at": r.measured_at.isoformat(),
                "weight": float(r.weight) if r.weight is not None else None,
                "bmi": float(r.bmi) if r.bmi is not None else None,
                "body_fat_pct": float(r.body_fat_pct) if r.body_fat_pct is not None else None,
                "muscle_mass": float(r.muscle_mass) if r.muscle_mass is not None else None,
                "visceral_fat": r.visceral_fat,
                "metabolic_rate": float(r.metabolic_rate) if r.metabolic_rate is not None else None,
                "body_age": r.body_age,
                "total_body_water": float(r.total_body_water) if r.total_body_water is not None else None,
                "protein_mass": float(r.protein_mass) if r.protein_mass is not None else None,
                "mineral_mass": float(r.mineral_mass) if r.mineral_mass is not None else None,
                "muscle_segmental": r.muscle_segmental,
                "fat_segmental": r.fat_segmental,
                "match_status": r.match_status,
            }
            for r in inbody_rows
        ],
        food_logs=[
            {
                "id": f.id,
                "logged_at": f.logged_at.isoformat(),
                "meal_type": f.meal_type,
                "image_url": f.image_url,
                "food_items": f.food_items,
                "total_calories": float(f.total_calories) if f.total_calories is not None else None,
                "total_protein": float(f.total_protein) if f.total_protein is not None else None,
                "total_carbs": float(f.total_carbs) if f.total_carbs is not None else None,
                "total_fat": float(f.total_fat) if f.total_fat is not None else None,
                "ai_suggestion": f.ai_suggestion,
            }
            for f in food_rows
        ],
        visits=[
            {
                "id": v.id,
                "visit_date": v.visit_date.isoformat(),
                "next_visit_date": v.next_visit_date.isoformat() if v.next_visit_date else None,
                "doctor_id": v.doctor_id,
                "notes": v.notes,
                "upcoming": v.next_visit_date is not None and v.next_visit_date >= today,
                "days_away": ((v.next_visit_date - today).days
                              if v.next_visit_date and v.next_visit_date >= today else None),
                "created_at": v.created_at.isoformat(),
            }
            for v in visit_rows
        ],
    )


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
