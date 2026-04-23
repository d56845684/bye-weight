from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Integer, String, Boolean, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models._mixin import AuditMixin


class MeetingSpeaker(AuditMixin, Base):
    """每場會議的 S1/S2 speaker → team_member / external 對照。
    auth_user_id NULL + is_external=True → 外部 speaker（客戶 / 未加入的新同事 / AI 未識別）。
    """
    __tablename__ = "meeting_speakers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    meeting_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    speaker_id: Mapped[str] = mapped_column(String(10), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    auth_user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    is_external: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    external_org: Mapped[str | None] = mapped_column(String(100))
    # alias_match / manual_override / unknown
    match_source: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    match_confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
