from datetime import date, datetime

from sqlalchemy import Boolean, Date, Integer, String, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from models._mixin import AuditMixin


class Base(DeclarativeBase):
    pass


class Patient(AuditMixin, Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 身份映射：對應 auth_db.users.id（UNIQUE；一個 auth user 對一個 patient profile）
    auth_user_id: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    # 多租戶 hard isolation：對應 auth_db.tenants.id；0=system
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    # his_id：將來對接健保 / 醫院 HIS 的外部主鍵；可留空。預設不開放 UI 編輯，
    # 直到 HIS 對接流程確定；admin 可填。
    his_id: Mapped[str | None] = mapped_column(String(20))
    # chart_no：現有診所系統的病歷號；同 tenant 內唯一（partial index 見 0006）。
    # InBody 自動攝取會以此欄位精準對應病患，比姓名+生日可靠。
    chart_no: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(20), nullable=False)
    sex: Mapped[str | None] = mapped_column(String(1))
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    national_id: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LineBinding(AuditMixin, Base):
    __tablename__ = "line_bindings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    clinic_id: Mapped[str | None] = mapped_column(String(20))  # tenant 底下的 sub-scope
    line_uuid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    bound_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Employee(AuditMixin, Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    line_uuid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    clinic_id: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(20), default="staff")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
