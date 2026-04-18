import asyncio
import logging
from datetime import date, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from utils.line import push_message
from utils import tenant_guard

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAYS = [30, 60, 120]


async def run_daily_notifications(db: AsyncSession):
    """
    每日通知排程（fix #4: 冪等設計，可安全重複執行）
    Cloud Scheduler 跨所有 tenant 掃排程，需 bypass RLS + tenant_guard。
    """
    with tenant_guard.bypass():
        await _run_daily_notifications_inner(db)


async def _run_daily_notifications_inner(db: AsyncSession):
    today = date.today()

    # 1. 回診提醒
    revisit_rows = await db.execute(
        text("""
        SELECT p.id, p.name, lb.line_uuid, v.next_visit_date, nr.days_before
        FROM patients p
        JOIN line_bindings lb ON p.id = lb.patient_id
        JOIN visits v ON p.id = v.patient_id
        JOIN notification_rules nr ON p.id = nr.patient_id
        WHERE nr.type = 'revisit' AND nr.active = TRUE
          AND v.next_visit_date = CURRENT_DATE + nr.days_before
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs nl
            WHERE nl.patient_id = p.id
              AND nl.type = 'revisit'
              AND nl.scheduled_at::date = CURRENT_DATE
          )
        """)
    )

    for row in revisit_rows:
        patient_id, name, line_uuid, visit_date, days_before = row
        message = f"親愛的 {name}，提醒您 {visit_date} 有回診預約，請記得準時到診。"
        await _send_with_retry(
            db, patient_id, line_uuid, "revisit", message, today
        )

    # 2. InBody 提醒
    inbody_rows = await db.execute(
        text("""
        SELECT p.id, p.name, lb.line_uuid, nr.interval_days
        FROM patients p
        JOIN line_bindings lb ON p.id = lb.patient_id
        JOIN notification_rules nr ON p.id = nr.patient_id
        WHERE nr.type = 'inbody' AND nr.active = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM inbody_records ir
            WHERE ir.patient_id = p.id
              AND ir.measured_at > NOW() - (nr.interval_days || ' days')::interval
          )
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs nl
            WHERE nl.patient_id = p.id
              AND nl.type = 'inbody'
              AND nl.scheduled_at::date = CURRENT_DATE
          )
        """)
    )

    for row in inbody_rows:
        patient_id, name, line_uuid, interval_days = row
        message = f"親愛的 {name}，距離上次 InBody 測量已超過 {interval_days} 天，建議回診測量。"
        await _send_with_retry(
            db, patient_id, line_uuid, "inbody", message, today
        )

    await db.commit()


async def _send_with_retry(
    db: AsyncSession,
    patient_id: int,
    line_uuid: str,
    notif_type: str,
    message: str,
    scheduled_date: date,
):
    # 先寫 pending 紀錄
    result = await db.execute(
        text("""
        INSERT INTO notification_logs (patient_id, type, format, message_content, status, scheduled_at, line_uuid)
        VALUES (:pid, :type, 'text', :msg, 'pending', :scheduled, :uuid)
        RETURNING id
        """),
        {
            "pid": patient_id,
            "type": notif_type,
            "msg": message,
            "scheduled": datetime.combine(scheduled_date, datetime.min.time()),
            "uuid": line_uuid,
        },
    )
    log_id = result.scalar_one()

    # 重試發送
    for attempt in range(MAX_RETRIES):
        success = await push_message(
            line_uuid, [{"type": "text", "text": message}]
        )
        if success:
            await db.execute(
                text(
                    "UPDATE notification_logs SET status = 'sent', sent_at = NOW() WHERE id = :id"
                ),
                {"id": log_id},
            )
            return

        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(RETRY_DELAYS[attempt])

    # 全部重試失敗
    await db.execute(
        text("UPDATE notification_logs SET status = 'failed' WHERE id = :id"),
        {"id": log_id},
    )
    logger.error(f"notification failed for patient {patient_id} after {MAX_RETRIES} retries")
