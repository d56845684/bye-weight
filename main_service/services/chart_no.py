"""病歷號 (chart_no) 產生器：同 tenant 內自動遞增 P000001, P000002, ...

為什麼這樣做：
  - 診所舊系統不一定有統一規則；我們統一成 `P` + 6 位 zero-padded 讓 InBody OCR
    好辨識（長度固定、字首明確）。
  - 同 tenant 內保證不重複，由 migration 0006 的 partial unique index 兜底。
  - 並發下 MAX+1 可能撞到，call site 要在 IntegrityError 時 retry（見 routers/patients.py）。
  - 只掃 `^P\d+$` 的 row；admin 手動指定「A12」之類的自訂 chart_no 不會卡住自動編號。
  - Soft-deleted patient 的 chart_no 也算進 MAX — 編號不重用比重用安全（舊的 InBody
    報告不會誤 match 到新病人）。
"""
import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


_PATTERN = re.compile(r"^P\d+$")


async def next_chart_no(db: AsyncSession, tenant_id: int) -> str:
    stmt = text(
        """
        SELECT COALESCE(MAX(CAST(SUBSTRING(chart_no FROM 2) AS INTEGER)), 0) + 1 AS n
        FROM patients
        WHERE tenant_id = :tid
          AND chart_no ~ '^P[0-9]+$'
        """
    )
    row = (await db.execute(stmt, {"tid": tenant_id})).one()
    return f"P{int(row.n):06d}"


def is_auto_chart_no(s: str | None) -> bool:
    return bool(s) and _PATTERN.match(s) is not None
