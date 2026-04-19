from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


# 台灣身分證：首碼 A-Z，次碼 1 (男) / 2 (女)，後接 8 位數字。
# 不包含完整 checksum 驗證（MVP 不必要；有需要再加）。
NATIONAL_ID_PATTERN = r"^[A-Z][12]\d{8}$"


class PatientRegisterRequest(BaseModel):
    """病患自己在 LIFF 首次登入填表用。"""
    name: str = Field(min_length=1, max_length=20)
    national_id: str = Field(pattern=NATIONAL_ID_PATTERN, max_length=20)
    sex: Literal["M", "F", "O"]
    birth_date: date
    phone: str = Field(min_length=1, max_length=20)
    address: str = Field(min_length=1, max_length=200)


class PatientCreateRequest(BaseModel):
    """管理後台 admin/staff 建立病患用（尚未綁 LINE 時）。
    跟 Register 相同欄位，但不接 auth_user_id —— 之後由 /patients/{id}/bind 綁。"""
    name: str = Field(min_length=1, max_length=20)
    national_id: str = Field(pattern=NATIONAL_ID_PATTERN, max_length=20)
    sex: Literal["M", "F", "O"]
    birth_date: date
    phone: str = Field(min_length=1, max_length=20)
    address: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=100)


class PatientUpdateRequest(BaseModel):
    """PATCH：所有欄位可選，只更新有傳的。"""
    name: str | None = Field(default=None, min_length=1, max_length=20)
    sex: Literal["M", "F", "O"] | None = None
    birth_date: date | None = None
    phone: str | None = Field(default=None, min_length=1, max_length=20)
    address: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=100)
    # national_id 一般不可改；要改請透過 SQL 直接處理或開獨立端點


class PatientOut(BaseModel):
    id: int
    auth_user_id: int | None
    tenant_id: int
    name: str
    sex: str | None
    birth_date: date
    phone: str | None
    email: str | None
    national_id: str | None
    address: str | None
