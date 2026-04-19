from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from models.patient import Base
from models._mixin import AuditMixin


class Visit(AuditMixin, Base):
    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    visit_date: Mapped[date] = mapped_column(Date, nullable=False)
    doctor_id: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)
    next_visit_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Medication(AuditMixin, Base):
    __tablename__ = "medications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visit_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    drug_name: Mapped[str | None] = mapped_column(String(100))
    frequency: Mapped[str | None] = mapped_column(String(20))
    days: Mapped[int | None] = mapped_column(Integer)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
