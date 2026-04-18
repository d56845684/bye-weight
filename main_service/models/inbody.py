from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.patient import Base


class InbodyRecord(Base):
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
    image_url: Mapped[str | None] = mapped_column(Text)
    raw_json: Mapped[dict | None] = mapped_column(JSONB)
    match_status: Mapped[str] = mapped_column(String(20), default="matched")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InbodyPending(Base):
    __tablename__ = "inbody_pending"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    uploaded_by: Mapped[int | None] = mapped_column(Integer)
    image_url: Mapped[str | None] = mapped_column(Text)
    ocr_name: Mapped[str | None] = mapped_column(String(20))
    ocr_birth_date: Mapped[date | None] = mapped_column(Date)
    ocr_data: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
