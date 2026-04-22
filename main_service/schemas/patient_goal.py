"""Patient goals — 營養師 / 醫師設定的目標 snapshot。

patient_goals 表採 append-only 歷史：每次調整 INSERT 新 row，
舊的不改（留稽核軌跡 + 之後 UI 可疊在趨勢圖上顯示目標變動）。
"""
from datetime import date, datetime

from pydantic import BaseModel, Field


class PatientGoalItem(BaseModel):
    """一筆歷史 goal snapshot。"""
    id: int
    patient_id: int
    effective_from: date
    daily_kcal: int | None = None
    target_weight: float | None = None
    target_body_fat: float | None = None
    target_carbs_pct: float | None = None
    target_protein_pct: float | None = None
    target_fat_pct: float | None = None
    set_by: int | None = None
    notes: str | None = None
    created_at: datetime
    # Tenant-wide list 用，病患 detail 頁不需要（反正就是同一人）
    patient_name: str | None = None
    chart_no: str | None = None


class PatientGoalCreateRequest(BaseModel):
    """建立新目標快照。所有欄位 optional（只填營養師要變動的），
    但至少要有一個非 null 值才算有效調整 —— handler 會檢查。"""
    patient_id: int
    effective_from: date | None = None  # 空值 → DB DEFAULT CURRENT_DATE
    daily_kcal: int | None = Field(default=None, ge=500, le=5000)
    target_weight: float | None = Field(default=None, ge=20, le=300)
    target_body_fat: float | None = Field(default=None, ge=3, le=60)
    target_carbs_pct: float | None = Field(default=None, ge=0, le=100)
    target_protein_pct: float | None = Field(default=None, ge=0, le=100)
    target_fat_pct: float | None = Field(default=None, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=500)
