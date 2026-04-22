from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.patient import Base
from models._mixin import AuditMixin


class FoodLog(AuditMixin, Base):
    __tablename__ = "food_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    meal_type: Mapped[str | None] = mapped_column(String(10))
    food_items: Mapped[dict | None] = mapped_column(JSONB)
    total_calories: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    total_protein: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    total_carbs: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    total_fat: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    ai_suggestion: Mapped[str | None] = mapped_column(Text)

    # 每次 read 都要用 selectinload 明確預載，避免踩到 N+1。
    # soft-deleted 的 image 過濾交給 query 自己 (.where(FoodLogImage.deleted_at.is_(None)))；
    # 不放在 primaryjoin 是因為 cascade / back_populates 碰到過濾條件會有行為驚喜，
    # 留給 caller 控制最簡單。DB FK 本身是 ON DELETE CASCADE，hard delete 由 DB 擔。
    images: Mapped[list["FoodLogImage"]] = relationship(  # noqa: F821
        "FoodLogImage",
        back_populates="food_log",
        order_by="FoodLogImage.position",
        lazy="select",
    )
