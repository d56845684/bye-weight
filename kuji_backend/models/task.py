from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Integer, String, Text, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models._mixin import AuditMixin


class TaskClip(AuditMixin, Base):
    """任務錄音片段 — AI 針對每個 task 識別出的 1 個主片段 + 最多 2 個相關片段。

    role = 'primary' | 'related'；rank 管 related 的順序。
    片段本體指向 transcript_segments（共享 segment.start_ms / end_ms / text），
    播放用的音源則從父 meeting.audio_url 取。
    """
    __tablename__ = "task_clips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    segment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("transcript_segments.id", ondelete="CASCADE"), nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="primary")
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Task(AuditMixin, Base):
    """行動事項 — AI 從 transcript 抽出或手動建立。

    status: todo / doing / done
    priority: high / med / low
    tag: notion / slack / gcal / email / teams / github（決定會被 route 到哪個整合）
    """
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    meeting_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="SET NULL"), index=True
    )
    source_segment_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("transcript_segments.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="todo")
    # owner_user_id 對應 auth_db.users.id（跨庫不 FK，應用層映射）
    owner_user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    owner_name: Mapped[str | None] = mapped_column(String(100))  # denormalized snapshot
    due_at: Mapped[datetime | None] = mapped_column(DateTime)
    due_label: Mapped[str | None] = mapped_column(String(50))   # "週三 5/06" / "明天 17:00"
    tag: Mapped[str | None] = mapped_column(String(20))
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="med")
    source_quote: Mapped[str | None] = mapped_column(Text)
    ai_confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
