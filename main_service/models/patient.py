from datetime import date, datetime

from sqlalchemy import Boolean, Date, Integer, String, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 身份映射：對應 auth_db.users.id（UNIQUE；一個 auth user 對一個 patient profile）
    auth_user_id: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    # 多租戶 hard isolation：對應 auth_db.tenants.id；0=system
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    his_id: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(20), nullable=False)
    sex: Mapped[str | None] = mapped_column(String(1))
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LineBinding(Base):
    __tablename__ = "line_bindings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    clinic_id: Mapped[str | None] = mapped_column(String(20))  # tenant 底下的 sub-scope
    line_uuid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    bound_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    line_uuid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    clinic_id: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(20), default="staff")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
