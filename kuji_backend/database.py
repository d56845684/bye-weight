"""DB engine + session + per-request tenant/user context.

抄 main_service 同 pattern：每個 transaction 起頭 `SET LOCAL ROLE app_user`，
透過 session-local 變數 app.current_tenant / app.current_user 驅動 RLS + audit。
"""
import os
from contextvars import ContextVar

from fastapi import Header
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv(
    "KUJI_DATABASE_URL",
    "postgresql+asyncpg://postgres:dev@localhost:5433/kuji_db",
)

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


_tenant_cv: ContextVar[int | None] = ContextVar("kuji_current_tenant", default=None)
_user_cv:   ContextVar[int | None] = ContextVar("kuji_current_user",   default=None)
_bypass_cv: ContextVar[bool] = ContextVar("kuji_rls_bypass", default=False)


class rls_bypass:
    """context manager：暫時放行 RLS（後台 / 排程用）。"""

    def __enter__(self):
        self._token = _bypass_cv.set(True)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        _bypass_cv.reset(self._token)


@event.listens_for(Session, "after_begin")
def _apply_session_context(session, transaction, connection):
    # SET LOCAL ROLE app_user：讓 RLS 生效（superuser 會 bypass）
    connection.execute(text("SET LOCAL ROLE app_user"))
    tid = _tenant_cv.get()
    uid = _user_cv.get()
    if tid is not None:
        connection.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tid)},
        )
    if uid is not None:
        connection.execute(
            text("SELECT set_config('app.current_user', :u, true)"),
            {"u": str(uid)},
        )
    if _bypass_cv.get():
        connection.execute(
            text("SELECT set_config('app.bypass_rls', 'true', true)")
        )


async def get_db(
    x_tenant_id: str | None = Header(default=None),
    x_user_id:   str | None = Header(default=None),
):
    """開 AsyncSession，把 tenant_id / user_id 塞進 contextvar 供 event listener 讀。"""
    tenant_token = _tenant_cv.set(int(x_tenant_id) if x_tenant_id else None)
    user_token   = _user_cv.set(int(x_user_id)   if x_user_id   else None)
    try:
        async with async_session() as session:
            yield session
    finally:
        _tenant_cv.reset(tenant_token)
        _user_cv.reset(user_token)
