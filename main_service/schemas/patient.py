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
    可選 auth_user_id：若 clinic-admin 先呼叫 /auth/admin/users/invite 建好 auth
    user 並拿到 id，這裡可以直接把 patient profile 綁上去，讓該 user 在 LIFF
    首次登入時就是已登錄狀態，不用再跑 /patient/register。

    chart_no：留空由後端 P000001 規則自動產生（同 tenant 不重複）；也可傳入自訂
    值蓋掉（例如從舊系統匯入）。
    his_id：不開放在建立時填；建立後由有權限的 admin 走 PATCH 補上（對接 HIS 用）。"""
    name: str = Field(min_length=1, max_length=20)
    national_id: str = Field(pattern=NATIONAL_ID_PATTERN, max_length=20)
    sex: Literal["M", "F", "O"]
    birth_date: date
    phone: str = Field(min_length=1, max_length=20)
    address: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=100)
    chart_no: str | None = Field(default=None, max_length=20)
    auth_user_id: int | None = None


class PatientUpdateRequest(BaseModel):
    """PATCH：所有欄位可選，只更新有傳的。
    his_id 限 admin / 有權限者修改（policy 層管控）。"""
    name: str | None = Field(default=None, min_length=1, max_length=20)
    sex: Literal["M", "F", "O"] | None = None
    birth_date: date | None = None
    phone: str | None = Field(default=None, min_length=1, max_length=20)
    address: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=100)
    chart_no: str | None = Field(default=None, max_length=20)
    his_id: str | None = Field(default=None, max_length=20)
    # national_id 一般不可改；要改請透過 SQL 直接處理或開獨立端點


class PatientOut(BaseModel):
    """Admin / staff 視角的完整 patient profile（含 his_id）。
    給病患自己看時改用 PatientSelfOut，會隱藏 his_id。"""
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
    chart_no: str | None
    his_id: str | None


class PatientSelfOut(BaseModel):
    """病患自己在 LIFF 看到的 profile：不含 his_id（那是 HIS 內部映射，非病患關心）。"""
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
    chart_no: str | None
