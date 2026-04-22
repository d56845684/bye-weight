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


class Segmental(BaseModel):
    """分部位肌肉 / 脂肪資料；五個區：左右臂、軀幹、左右腿，單位 kg。"""
    la: float | None = None  # left arm
    ra: float | None = None  # right arm
    tr: float | None = None  # trunk
    ll: float | None = None  # left leg
    rl: float | None = None  # right leg


class InbodyLatest(BaseModel):
    """病患 /me/summary 用：最新一筆 + 上一筆算出 delta 直接吐回給前端。
    沒 prev（只有 1 筆紀錄）時 *_prev 會是 None。"""
    measured_at: datetime
    weight: float | None = None
    weight_prev: float | None = None
    bmi: float | None = None
    bmi_prev: float | None = None
    body_fat_pct: float | None = None
    body_fat_pct_prev: float | None = None
    muscle_mass: float | None = None
    muscle_mass_prev: float | None = None
    visceral_fat: int | None = None
    visceral_fat_prev: int | None = None
    metabolic_rate: float | None = None
    metabolic_rate_prev: float | None = None
    # Phase 3 擴充
    body_age: int | None = None
    body_age_prev: int | None = None
    total_body_water: float | None = None
    protein_mass: float | None = None
    mineral_mass: float | None = None
    muscle_segmental: Segmental | None = None
    fat_segmental: Segmental | None = None


class InbodySeries(BaseModel):
    """30 天序列（時間升冪）。dates 跟三條數值序列等長，前端畫圖用。"""
    dates: list[str]
    weight: list[float | None]
    body_fat_pct: list[float | None]
    muscle_mass: list[float | None]


class InbodyFullRecord(BaseModel):
    """完整 record 欄位，給病患 Body tab 切換歷史用。
    跟 InbodyLatest 差別：沒有 *_prev（選到哪一筆，delta 由前端用 records[index+1] 算）。"""
    id: int
    measured_at: datetime
    weight: float | None = None
    bmi: float | None = None
    body_fat_pct: float | None = None
    muscle_mass: float | None = None
    visceral_fat: int | None = None
    metabolic_rate: float | None = None
    body_age: int | None = None
    total_body_water: float | None = None
    protein_mass: float | None = None
    mineral_mass: float | None = None
    muscle_segmental: Segmental | None = None
    fat_segmental: Segmental | None = None


class InbodySummary(BaseModel):
    latest: InbodyLatest | None = None
    series: InbodySeries
    # 時序 desc（最新在 [0]），前端下拉選單 + 切換 delta 用。
    # 不超過 summary 的 days limit；延伸歷史走 /inbody/history。
    records: list[InbodyFullRecord] = []
