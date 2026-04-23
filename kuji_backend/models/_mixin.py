"""稽核欄位 mixin — 對應 migration 0003 的 trigger audit_autofill()。"""
from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column


class AuditMixin:
    created_by: Mapped[int | None] = mapped_column(Integer, default=None)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    updated_by: Mapped[int | None] = mapped_column(Integer, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, default=None, index=True)
    deleted_by: Mapped[int | None] = mapped_column(Integer, default=None)
