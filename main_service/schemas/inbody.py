from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class InbodyHistoryItem(BaseModel):
    id: int
    measured_at: datetime
    weight: float | None = None
    bmi: float | None = None
    body_fat_pct: float | None = None
    muscle_mass: float | None = None
    visceral_fat: int | None = None
    metabolic_rate: float | None = None


class InbodyUploadRequest(BaseModel):
    image_url: str


class InbodyUploadResponse(BaseModel):
    status: str
    patient_id: int | None = None
    candidates: list[int] = []
    reason: str | None = None


class PendingPatientCandidate(BaseModel):
    """ambiguous 時，列出同名的候選病患讓 admin 挑。"""
    id: int
    name: str
    chart_no: str | None = None
    birth_date: date | None = None


class InbodyPendingItem(BaseModel):
    id: int
    status: str
    uploaded_at: datetime
    uploaded_by: int | None = None
    image_url: str | None = None
    ocr_name: str | None = None
    ocr_birth_date: date | None = None
    ocr_chart_no: str | None = None
    ocr_data: dict[str, Any] | None = None
    # ambiguous 狀況：同名候選；其他狀態回空 list
    candidates: list[PendingPatientCandidate] = []


class ResolvePendingRequest(BaseModel):
    """人工指派 pending 到某個 patient。產生一筆 inbody_records。"""
    patient_id: int


class InbodyRecordItem(BaseModel):
    """Admin 後台列表用：帶病患姓名 / 病歷號 / 租戶，方便顯示不用再打一次 API。"""
    id: int
    patient_id: int
    patient_name: str | None = None
    chart_no: str | None = None
    tenant_id: int
    measured_at: datetime
    weight: float | None = None
    bmi: float | None = None
    body_fat_pct: float | None = None
    muscle_mass: float | None = None
    visceral_fat: int | None = None
    metabolic_rate: float | None = None
    match_status: str | None = None
    uploaded_by: int | None = None
