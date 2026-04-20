"""InBody API。

兩類使用者：
- 病患 LIFF：`GET /inbody/history` 讀自己的。
- Admin / nutritionist 後台：`GET/POST /inbody/pending/*` 處理 OCR 後
  無法自動歸屬的 pending（ambiguous / unmatched / ocr_failed）。

員工上傳入口走 LINE OA webhook（routers/line_webhook.py → services/inbody_ingest.py）。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, rls_bypass
from deps import current_patient, current_user
from models.inbody import InbodyPending, InbodyRecord
from models.patient import Patient
from schemas.inbody import (
    InbodyPendingItem,
    InbodyRecordItem,
    PendingPatientCandidate,
    ResolvePendingRequest,
)
from utils.cache import invalidate

router = APIRouter(prefix="/inbody", tags=["inbody"])


# pending 狀態機：
#   ambiguous / unmatched / ocr_failed / pending → resolved（admin 指派）或 discarded（丟棄）
# 只有這四個是「待處理」狀態；resolved / discarded 從列表過濾掉。
OPEN_STATES = {"ambiguous", "unmatched", "ocr_failed", "pending"}


@router.get("/history")
async def inbody_history(
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(InbodyRecord)
        .where(
            InbodyRecord.patient_id == patient.id,
            InbodyRecord.tenant_id == user["tenant_id"],
        )
        .order_by(InbodyRecord.measured_at.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    records = result.scalars().all()
    return [
        {
            "id": r.id,
            "measured_at": r.measured_at.isoformat(),
            "weight": float(r.weight) if r.weight else None,
            "bmi": float(r.bmi) if r.bmi else None,
            "body_fat_pct": float(r.body_fat_pct) if r.body_fat_pct else None,
            "muscle_mass": float(r.muscle_mass) if r.muscle_mass else None,
            "visceral_fat": r.visceral_fat,
            "metabolic_rate": float(r.metabolic_rate) if r.metabolic_rate else None,
        }
        for r in records
    ]


@router.get("/records", response_model=list[InbodyRecordItem])
async def list_records(
    patient_id: int | None = Query(None, description="只列某個病患的紀錄"),
    all_tenants: bool = Query(
        False,
        description="僅 super_admin 可用；為 true 時回傳所有租戶紀錄",
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin 視角：列出所有 inbody_records。
    - 預設限當前 tenant。
    - super_admin 可傳 all_tenants=true 看跨租戶（其他角色此參數被忽略）。
    - 回應 join patient 取姓名 / 病歷號，前端不用再打第二次。
    - 病患讀自己的走 /inbody/history，不吃這支；IAM resource template 已擋下。"""
    cross_tenant = all_tenants and user.get("role") == "super_admin"

    conds = [InbodyRecord.deleted_at.is_(None)]
    if not cross_tenant:
        conds.append(InbodyRecord.tenant_id == user["tenant_id"])
    if patient_id is not None:
        conds.append(InbodyRecord.patient_id == patient_id)

    stmt = (
        select(InbodyRecord, Patient.name, Patient.chart_no)
        .join(Patient, Patient.id == InbodyRecord.patient_id, isouter=True)
        .where(*conds)
        .order_by(InbodyRecord.measured_at.desc())
        .limit(limit)
        .offset(offset)
    )
    # 跨租戶需要跳過 PostgreSQL RLS（app.bypass_rls=true）。rls_bypass 在下一個 tx
    # 開始時被 after_begin listener 讀到；此處進入 context 後再跑 query 才會生效。
    if cross_tenant:
        with rls_bypass():
            rows = (await db.execute(stmt)).all()
    else:
        rows = (await db.execute(stmt)).all()
    return [
        InbodyRecordItem(
            id=r.id,
            patient_id=r.patient_id,
            patient_name=pname,
            chart_no=pchart,
            tenant_id=r.tenant_id,
            measured_at=r.measured_at,
            weight=float(r.weight) if r.weight is not None else None,
            bmi=float(r.bmi) if r.bmi is not None else None,
            body_fat_pct=float(r.body_fat_pct) if r.body_fat_pct is not None else None,
            muscle_mass=float(r.muscle_mass) if r.muscle_mass is not None else None,
            visceral_fat=r.visceral_fat,
            metabolic_rate=float(r.metabolic_rate) if r.metabolic_rate is not None else None,
            match_status=r.match_status,
            uploaded_by=r.uploaded_by,
        )
        for r, pname, pchart in rows
    ]


@router.get("/pending", response_model=list[InbodyPendingItem])
async def list_pending(
    status: str | None = Query(
        None,
        description="逗號分隔的 status 過濾；預設只回待處理狀態",
    ),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin / nutritionist 用。列出需要人工處理的 inbody_pending。
    tenant 限制 = IAM policy + tenant_id WHERE（defense-in-depth）。

    ambiguous 狀況會帶上 candidates（同名病患）讓 UI 直接挑。"""
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
    else:
        statuses = list(OPEN_STATES)

    stmt = (
        select(InbodyPending)
        .where(
            InbodyPending.tenant_id == user["tenant_id"],
            InbodyPending.status.in_(statuses),
        )
        .order_by(InbodyPending.uploaded_at.desc())
        .limit(200)
    )
    rows = (await db.execute(stmt)).scalars().all()

    # 一次把所有 ambiguous 列的同名病患撈起來，避免 N+1
    ambiguous_names = {r.ocr_name for r in rows if r.status == "ambiguous" and r.ocr_name}
    candidates_by_name: dict[str, list[PendingPatientCandidate]] = {}
    if ambiguous_names:
        cstmt = select(Patient).where(
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
            Patient.name.in_(ambiguous_names),
        )
        for p in (await db.execute(cstmt)).scalars().all():
            candidates_by_name.setdefault(p.name, []).append(
                PendingPatientCandidate(
                    id=p.id,
                    name=p.name,
                    chart_no=p.chart_no,
                    birth_date=p.birth_date,
                )
            )

    out: list[InbodyPendingItem] = []
    for r in rows:
        out.append(
            InbodyPendingItem(
                id=r.id,
                status=r.status,
                uploaded_at=r.uploaded_at,
                uploaded_by=r.uploaded_by,
                image_url=r.image_url,
                ocr_name=r.ocr_name,
                ocr_birth_date=r.ocr_birth_date,
                ocr_chart_no=r.ocr_chart_no,
                ocr_data=r.ocr_data,
                candidates=(
                    candidates_by_name.get(r.ocr_name or "", [])
                    if r.status == "ambiguous"
                    else []
                ),
            )
        )
    return out


async def _load_open_pending(db: AsyncSession, tenant_id: int, pending_id: int) -> InbodyPending:
    stmt = select(InbodyPending).where(
        InbodyPending.id == pending_id,
        InbodyPending.tenant_id == tenant_id,
    )
    pending = (await db.execute(stmt)).scalar_one_or_none()
    if pending is None:
        raise HTTPException(404, "pending not found")
    if pending.status not in OPEN_STATES:
        raise HTTPException(409, f"pending already {pending.status}")
    return pending


@router.post("/pending/{pending_id}/resolve")
async def resolve_pending(
    pending_id: int,
    payload: ResolvePendingRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """人工指派 pending 到某個 patient。
    - 驗證 patient 存在且同 tenant、未軟刪除。
    - ocr_failed 不能 resolve（沒有 OCR 數據可寫）。
    - 成功：建 inbody_records 1 筆，pending.status = resolved。"""
    pending = await _load_open_pending(db, user["tenant_id"], pending_id)
    if pending.status == "ocr_failed":
        raise HTTPException(400, "ocr_failed pending cannot be resolved; please discard")

    patient = (await db.execute(
        select(Patient).where(
            Patient.id == payload.patient_id,
            Patient.tenant_id == user["tenant_id"],
            Patient.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if patient is None:
        raise HTTPException(404, "target patient not found")

    ocr = pending.ocr_data or {}
    record = InbodyRecord(
        patient_id=patient.id,
        tenant_id=user["tenant_id"],
        uploaded_by=pending.uploaded_by,
        # OCR 沒吐 measured_at，用 pending 上傳時間當 proxy
        measured_at=pending.uploaded_at or datetime.utcnow(),
        weight=ocr.get("weight"),
        bmi=ocr.get("bmi"),
        body_fat_pct=ocr.get("body_fat_pct"),
        muscle_mass=ocr.get("muscle_mass"),
        visceral_fat=ocr.get("visceral_fat"),
        metabolic_rate=ocr.get("metabolic_rate"),
        image_url=pending.image_url,
        raw_json=ocr,
        match_status="manual",  # 與自動 matched 區分
    )
    db.add(record)
    pending.status = "resolved"
    await db.commit()
    await invalidate(f"cache:inbody:{patient.id}")
    return {
        "status": "resolved",
        "pending_id": pending.id,
        "record_id": record.id,
        "patient_id": patient.id,
    }


@router.post("/pending/{pending_id}/discard")
async def discard_pending(
    pending_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """丟棄 pending（誤傳 / 重複 / 無法辨識）。不建 inbody_records。"""
    pending = await _load_open_pending(db, user["tenant_id"], pending_id)
    pending.status = "discarded"
    await db.commit()
    return {"status": "discarded", "pending_id": pending.id}
