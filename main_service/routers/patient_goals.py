"""Patient goals — 營養師設定的目標歷史。

表 `patient_goals` append-only，每次調整 INSERT 新 row 不 UPDATE。
讀「當前目標」= ORDER BY effective_from DESC LIMIT 1。

行為拆分：
  POST /patient-goals                  新增一筆 snapshot（C flow）
  GET  /patient-goals?patient_id=N     列該病患歷史（B flow 個人視角）
  GET  /patient-goals/records          tenant-wide 最新一筆/人（B flow 全 tenant）

權限由 auth_service 的 action_mapping + policy 層控：
  main:goal:write  —— nutritionist / clinic-admin
  main:goal:read   —— nutritionist / clinic-admin / staff
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.patient import Patient, PatientGoal
from schemas.patient_goal import PatientGoalCreateRequest, PatientGoalItem

router = APIRouter(prefix="/patient-goals", tags=["patient-goals"])


def _to_item(g: PatientGoal, patient_name: str | None = None, chart_no: str | None = None) -> PatientGoalItem:
    return PatientGoalItem(
        id=g.id,
        patient_id=g.patient_id,
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
        patient_name=patient_name,
        chart_no=chart_no,
    )


@router.post("", response_model=PatientGoalItem, status_code=201)
async def create_goal(
    payload: PatientGoalCreateRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """營養師 / admin 新增 goal snapshot。

    - 驗證 patient 在 caller 的 tenant 內（defense-in-depth，IAM 已經 scope）
    - 至少有一個目標欄位非 null（空 INSERT 沒意義）
    - set_by 自動帶 caller user_id
    """
    # 至少一個目標欄位
    goal_fields = [
        payload.daily_kcal, payload.target_weight, payload.target_body_fat,
        payload.target_carbs_pct, payload.target_protein_pct, payload.target_fat_pct,
    ]
    if all(v is None for v in goal_fields):
        raise HTTPException(400, "at least one target field (daily_kcal / target_* / *_pct) required")

    # 確認 patient 在 caller tenant
    patient = (await db.execute(
        select(Patient).where(
            Patient.id == payload.patient_id,
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if patient is None:
        raise HTTPException(404, "patient not found")

    goal = PatientGoal(
        patient_id=payload.patient_id,
        tenant_id=user["tenant_id"],
        daily_kcal=payload.daily_kcal,
        target_weight=payload.target_weight,
        target_body_fat=payload.target_body_fat,
        target_carbs_pct=payload.target_carbs_pct,
        target_protein_pct=payload.target_protein_pct,
        target_fat_pct=payload.target_fat_pct,
        effective_from=payload.effective_from or datetime.utcnow().date(),
        set_by=user["user_id"],
        notes=payload.notes,
    )
    db.add(goal)
    await db.commit()
    return _to_item(goal, patient_name=patient.name, chart_no=patient.chart_no)


@router.get("", response_model=list[PatientGoalItem])
async def list_goals(
    patient_id: int | None = Query(None, description="單一病患 filter；不傳則列 tenant-wide"),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """列 goal 歷史。
    - `?patient_id=N` → 該病患完整歷史，依 effective_from desc
    - 無 patient_id → tenant-wide 列（每病患最新一筆，其他歷史隱藏；UI 可展開）
    """
    if patient_id is not None:
        stmt = (
            select(PatientGoal, Patient.name, Patient.chart_no)
            .join(Patient, Patient.id == PatientGoal.patient_id)
            .where(
                PatientGoal.patient_id == patient_id,
                PatientGoal.tenant_id == user["tenant_id"],
                PatientGoal.deleted_at.is_(None),
            )
            .order_by(PatientGoal.effective_from.desc())
            .limit(100)
        )
        rows = (await db.execute(stmt)).all()
        return [_to_item(g, patient_name=pn, chart_no=pc) for g, pn, pc in rows]

    # tenant-wide：所有 goals（B flow admin 看全體）
    stmt = (
        select(PatientGoal, Patient.name, Patient.chart_no)
        .join(Patient, Patient.id == PatientGoal.patient_id)
        .where(
            PatientGoal.tenant_id == user["tenant_id"],
            PatientGoal.deleted_at.is_(None),
            Patient.deleted_at.is_(None),
        )
        .order_by(PatientGoal.effective_from.desc(), PatientGoal.id.desc())
        .limit(500)
    )
    rows = (await db.execute(stmt)).all()
    return [_to_item(g, patient_name=pn, chart_no=pc) for g, pn, pc in rows]
