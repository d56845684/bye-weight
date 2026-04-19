"""稽核欄位 mixin。

所有業務 model 繼承 AuditMixin 才能 ORM 操作 created_by / updated_at /
updated_by / deleted_at / deleted_by（由 DB trigger audit_autofill() 自動填，
但 Python 端必須宣告才能在 query 引用 / read 後存取）。

對應的 DB schema 由 alembic 0004_audit_columns 維護。
"""
from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column


class AuditMixin:
    created_by: Mapped[int | None] = mapped_column(Integer, default=None)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    updated_by: Mapped[int | None] = mapped_column(Integer, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, default=None, index=True)
    deleted_by: Mapped[int | None] = mapped_column(Integer, default=None)
