from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.patient import Base
from models._mixin import AuditMixin


class FoodLogImage(AuditMixin, Base):
    """飲食紀錄的照片。一筆 food_log 可有 N 張圖。
    blob_path = GCS object 路徑；讀取時由前端（或專屬 endpoint）換 signed URL。"""

    __tablename__ = "food_log_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    food_log_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("food_logs.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    blob_path: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    caption: Mapped[str | None] = mapped_column(Text)
    ai_analysis: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    food_log: Mapped["FoodLog"] = relationship("FoodLog", back_populates="images")  # noqa: F821
