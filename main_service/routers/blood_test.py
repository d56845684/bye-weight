"""抽血報告 API。

- 後台同步（admin）：`POST /blood-test-reports/sync` 觸發 Healthleader 同步。
  同步可能跑數十秒（逐病患 + 逐報告 + 2s 節流），所以丟 BackgroundTasks 背景跑，
  立刻回 accepted；背景用自己的 session_context（request 的 db 會在回應後關閉）。
- 後台檢視（admin）：`GET /blood-test-reports/records` tenant-scoped 列表。
- 病患自取：`GET /blood-test-reports` 看自己的報告。

權限細節已在 auth_service IAM policy 做掉；這裡的 role 判斷 + tenant_id WHERE
是 defense-in-depth。
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, rls_bypass, session_context
from deps import current_patient, current_user
from models.blood_test import BloodTestReport
from models.patient import Patient
from schemas.blood_test import BloodTestReportItem, SyncResult
from services.blood_test_sync import sync_blood_tests

router = APIRouter(prefix="/blood-test-reports", tags=["blood-test-reports"])
log = logging.getLogger(__name__)

# 可觸發同步 / 看後台列表的角色（patient 只能看自己的，走 GET /）
ADMIN_ROLES = {"staff", "nutritionist", "admin", "super_admin"}


async def _run_sync(tenant_id: int, user_id: int, patient_id: int | None) -> None:
    """背景同步：用獨立 session_context（RLS + audit 自動）。"""
    try:
        async with session_context(tenant_id=tenant_id, user_id=user_id) as db:
            result = await sync_blood_tests(db, tenant_id, user_id, patient_id)
        log.info("blood test sync done tenant=%s patient=%s: %s", tenant_id, patient_id, result)
    except Exception as e:  # noqa: BLE001 — 背景任務不能讓例外逸出
        log.exception("blood test sync failed tenant=%s: %s", tenant_id, e)


@router.post("/sync", response_model=SyncResult, status_code=202)
async def trigger_sync(
    background_tasks: BackgroundTasks,
    patient_id: int | None = Query(None, description="只同步某位病患；省略則同步整個 tenant"),
    user: dict = Depends(current_user),
):
    """後台手動觸發 Healthleader 抽血報告同步（背景跑）。"""
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(403, "無權觸發抽血報告同步")
    background_tasks.add_task(_run_sync, user["tenant_id"], user["user_id"], patient_id)
    return SyncResult(status="accepted", patient_id=patient_id)


@router.get("/records", response_model=list[BloodTestReportItem])
async def list_records(
    patient_id: int | None = Query(None, description="只列某個病患的報告"),
    all_tenants: bool = Query(False, description="僅 super_admin 可用；跨租戶檢視"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """後台列表：預設限當前 tenant，join patient 取姓名 / 病歷號。"""
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(403, "無權檢視後台抽血報告列表")
    cross_tenant = all_tenants and user.get("role") == "super_admin"

    conds = [BloodTestReport.deleted_at.is_(None)]
    if not cross_tenant:
        conds.append(BloodTestReport.tenant_id == user["tenant_id"])
    if patient_id is not None:
        conds.append(BloodTestReport.patient_id == patient_id)

    stmt = (
        select(BloodTestReport, Patient.name, Patient.chart_no)
        .join(Patient, Patient.id == BloodTestReport.patient_id, isouter=True)
        .where(*conds)
        .order_by(BloodTestReport.test_date.desc())
        .limit(limit)
        .offset(offset)
    )
    if cross_tenant:
        with rls_bypass():
            rows = (await db.execute(stmt)).all()
    else:
        rows = (await db.execute(stmt)).all()

    return [_to_item(r, pname, pchart) for r, pname, pchart in rows]


@router.get("", response_model=list[BloodTestReportItem])
async def my_reports(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(current_user),
    patient: Patient = Depends(current_patient),
    db: AsyncSession = Depends(get_db),
):
    """病患讀自己的抽血報告（時序 desc）。"""
    stmt = (
        select(BloodTestReport)
        .where(
            BloodTestReport.patient_id == patient.id,
            BloodTestReport.tenant_id == user["tenant_id"],
            BloodTestReport.deleted_at.is_(None),
        )
        .order_by(BloodTestReport.test_date.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_item(r, patient.name, patient.chart_no) for r in rows]


def _to_item(r: BloodTestReport, patient_name: str | None, chart_no: str | None) -> BloodTestReportItem:
    return BloodTestReportItem(
        id=r.id,
        patient_id=r.patient_id,
        patient_name=patient_name,
        chart_no=chart_no,
        tenant_id=r.tenant_id,
        hl_report_id=r.hl_report_id,
        hl_mrno=r.hl_mrno,
        detect_no=r.detect_no,
        clinic_name=r.clinic_name,
        test_date=r.test_date,
        lab_values=r.lab_values,
    )
