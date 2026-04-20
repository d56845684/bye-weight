from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.patient import Base
from models._mixin import AuditMixin


class FoodLog(AuditMixin, Base):
    __tablename__ = "food_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    meal_type: Mapped[str | None] = mapped_column(String(10))
    image_url: Mapped[str | None] = mapped_column(Text)
    food_items: Mapped[dict | None] = mapped_column(JSONB)
    total_calories: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    total_protein: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    total_carbs: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    total_fat: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    ai_suggestion: Mapped[str | None] = mapped_column(Text)
