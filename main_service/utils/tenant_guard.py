"""
Tenant guard — defense-in-depth for hard-isolation multi-tenancy.

攔截所有 ORM SELECT / UPDATE / DELETE，若觸及 TENANT_SCOPED_TABLES 列出的表
但 SQL 裡沒有 tenant_id 過濾條件，則立即 raise。

理由：auth_service 已經在 URL 層擋住跨租戶的 resource ARN，但下游服務仍然
必須在資料層同步過濾。此 guard 確保開發者漏寫 WHERE tenant_id 時在 dev / CI
立刻發現，而不是等到上線才出包。

對於合法的跨租戶操作（例如 Cloud Scheduler 掃全體租戶跑排程），用：

    with tenant_guard.bypass():
        ...
"""
import re
from contextvars import ContextVar

from sqlalchemy import event
from sqlalchemy.orm import Session

# 所有跟特定 tenant 綁定的業務表（對應 main_service 0002 migration 加 tenant_id 的那批）
TENANT_SCOPED_TABLES = {
    "patients",
    "line_bindings",
    "employees",
    "visits",
    "medications",
    "inbody_records",
    "inbody_pending",
    "food_logs",
    "notification_rules",
    "notification_logs",
}

_bypass_var: ContextVar[bool] = ContextVar("tenant_guard_bypass", default=False)
_TENANT_PREDICATE = re.compile(r"\btenant_id\b\s*(?:=|IN\s*\()", re.IGNORECASE)


class bypass:
    """Context manager：同時關掉本 guard 與資料庫 RLS policy。

    用途：跨租戶排程（Cloud Scheduler）、LINE webhook 尚未判斷 tenant 前的
    line_bindings 查詢。

        with tenant_guard.bypass():
            rows = await db.execute(text("SELECT ... FROM patients ..."))
    """

    def __enter__(self):
        # 延遲 import 避免 circular（database.py 不 import tenant_guard）
        from database import rls_bypass

        self._rls = rls_bypass()
        self._rls.__enter__()
        self._token = _bypass_var.set(True)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        _bypass_var.reset(self._token)
        self._rls.__exit__(exc_type, exc_val, exc_tb)


def _touched_tenant_tables(stmt) -> set[str]:
    names: set[str] = set()
    try:
        for tbl in stmt.get_final_froms():
            name = getattr(tbl, "name", None)
            if name:
                names.add(name)
    except Exception:
        # 罕見的 statement 形狀，保守跳過，不阻斷查詢
        return set()
    return names & TENANT_SCOPED_TABLES


@event.listens_for(Session, "do_orm_execute")
def _enforce_tenant_filter(state):
    if _bypass_var.get():
        return
    if state.is_insert:
        # INSERT 的 tenant_id 由 row instance 設定，不會出現在 WHERE，故略過
        return
    if not (state.is_select or state.is_update or state.is_delete):
        return

    stmt = state.statement
    scoped = _touched_tenant_tables(stmt)
    if not scoped:
        return

    compiled = str(stmt.compile(compile_kwargs={"literal_binds": False}))
    if _TENANT_PREDICATE.search(compiled):
        return

    op = (
        "SELECT"
        if state.is_select
        else ("UPDATE" if state.is_update else "DELETE")
    )
    raise RuntimeError(
        f"[tenant_guard] {op} on {sorted(scoped)} is missing a tenant_id predicate. "
        f"Add `WHERE <Model>.tenant_id == user['tenant_id']` or wrap the call in "
        f"`with tenant_guard.bypass():` for legitimate cross-tenant queries."
    )
