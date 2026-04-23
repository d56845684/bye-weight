from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models._mixin import AuditMixin


class TeamMember(AuditMixin, Base):
    """團隊成員 — kuji 裡的 display_name + aliases（給 ASR 對齊說話者用）。
    auth_user_id 映射到 auth_db.users.id（跨庫不 FK）。
    """
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    auth_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(200))
    role_label: Mapped[str] = mapped_column(String(20), nullable=False, default="Member")  # Admin/Member/Viewer
    # aliases：["怡君", "Emily", "EM"] — ASR / LLM 用來對齊 speaker 對應的 auth_user_id
    aliases: Mapped[list] = mapped_column(postgresql.JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
