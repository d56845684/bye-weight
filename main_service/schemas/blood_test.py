from datetime import datetime

from pydantic import BaseModel


class BloodTestReportItem(BaseModel):
    id: int
    patient_id: int
    patient_name: str | None = None
    chart_no: str | None = None
    tenant_id: int
    hl_report_id: str
    hl_mrno: str | None = None
    detect_no: str | None = None
    clinic_name: str | None = None
    test_date: datetime
    # {"WBC": {"value": 5.2, "flag": "H"}, ...}
    lab_values: dict | None = None


class SyncResult(BaseModel):
    status: str           # "accepted"（背景跑）
    patient_id: int | None = None
