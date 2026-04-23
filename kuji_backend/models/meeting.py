from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models._mixin import AuditMixin


class Meeting(AuditMixin, Base):
    """會議 — 錄音 / 上傳的單位。

    status: recording(進行中) / processing(轉寫中) / done(完成)
    source: record(即時錄音) / upload(上傳音檔) / zoom / teams / meet
    """
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    speaker_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="done")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="upload")
    # 會議錄音檔 URL（GCS / CDN / 本地 public/sample/ 皆可）。正式版會是 GCS signed URL
    audio_url: Mapped[str | None] = mapped_column(Text)
    # 會議 summary（mock 先放純文字；正式版改 JSONB）
    summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TranscriptSegment(AuditMixin, Base):
    """Transcript 逐字稿 — 一個 meeting 多段。"""
    __tablename__ = "transcript_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    meeting_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    speaker_id: Mapped[str] = mapped_column(String(10), nullable=False)   # S1 / S2 ...
    speaker_name: Mapped[str | None] = mapped_column(String(100))
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # highlight 類型：task(行動事項) / decision(決議) / question(問題) / null
    highlight: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
