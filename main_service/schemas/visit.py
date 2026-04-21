from datetime import date, datetime

from pydantic import BaseModel


class VisitTimelineItem(BaseModel):
    """病患 /me/timeline 用。`upcoming` 依 next_visit_date > today 判定。"""
    id: int
    visit_date: date
    next_visit_date: date | None = None
    doctor_id: str | None = None
    notes: str | None = None
    upcoming: bool = False
    days_away: int | None = None   # upcoming=true 時才填；= next_visit_date - today
    created_at: datetime


class VisitAdminItem(BaseModel):
    """Admin tenant-wide 列表用：帶病患姓名 / 病歷號。"""
    id: int
    patient_id: int
    patient_name: str | None = None
    chart_no: str | None = None
    visit_date: date
    next_visit_date: date | None = None
    doctor_id: str | None = None
    notes: str | None = None
    upcoming: bool = False
    days_away: int | None = None
    created_at: datetime
