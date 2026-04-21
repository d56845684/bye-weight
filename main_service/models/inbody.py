from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.patient import Base
from models._mixin import AuditMixin


class InbodyRecord(AuditMixin, Base):
    __tablename__ = "inbody_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    uploaded_by: Mapped[int | None] = mapped_column(Integer)
    measured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    weight: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    bmi: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    body_fat_pct: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    muscle_mass: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    visceral_fat: Mapped[int | None] = mapped_column(Integer)
    metabolic_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 0))
    # Phase 3 擴充：身體年齡 + 水分 / 蛋白 / 礦物（OCR prompt 擴充後才有資料，舊 row 為 NULL）
    body_age: Mapped[int | None] = mapped_column(Integer)
    total_body_water: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    protein_mass: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    mineral_mass: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    # 分部位肌肉 / 脂肪：{la, ra, tr, ll, rl}（左右臂 / 軀幹 / 左右腿），單位 kg
    muscle_segmental: Mapped[dict | None] = mapped_column(JSONB)
    fat_segmental: Mapped[dict | None] = mapped_column(JSONB)
    image_url: Mapped[str | None] = mapped_column(Text)
    raw_json: Mapped[dict | None] = mapped_column(JSONB)
    match_status: Mapped[str] = mapped_column(String(20), default="matched")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InbodyPending(AuditMixin, Base):
    __tablename__ = "inbody_pending"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    uploaded_by: Mapped[int | None] = mapped_column(Integer)
    image_url: Mapped[str | None] = mapped_column(Text)
    ocr_name: Mapped[str | None] = mapped_column(String(20))
    ocr_birth_date: Mapped[date | None] = mapped_column(Date)
    ocr_chart_no: Mapped[str | None] = mapped_column(String(20))
    ocr_data: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
