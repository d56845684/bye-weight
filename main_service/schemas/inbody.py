from datetime import datetime
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
