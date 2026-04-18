import os
from contextvars import ContextVar

from fastapi import Header
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv(
    "APP_DATABASE_URL",
    "postgresql+asyncpg://postgres:dev@localhost:5433/app_db",
)

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# ── 每個 request 透過 contextvar 傳遞 RLS 上下文 ────────────────
# get_db 依 header X-Tenant-Id 寫 contextvar，after_begin event 套用到 DB。
_tenant_cv: ContextVar[int | None] = ContextVar("app_current_tenant", default=None)
_bypass_cv: ContextVar[bool] = ContextVar("app_rls_bypass", default=False)


class rls_bypass:
    """Context manager：暫時放行 RLS（供跨租戶排程 / webhook 使用）。

    用法：
        with rls_bypass():
            # 接下來的 queries 不受 tenant_id 限制
            ...
    """

    def __enter__(self):
        self._token = _bypass_cv.set(True)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        _bypass_cv.reset(self._token)


# ── 每次 transaction 開始時把 RLS 上下文塞進 session-local 變數 ──
# postgres superuser 預設會 bypass RLS；SET LOCAL ROLE app_user 讓 RLS 生效。
# migration 0003 已建 app_user role + GRANT 權限。
@event.listens_for(Session, "after_begin")
def _apply_rls_context(session, transaction, connection):
    connection.execute(text("SET LOCAL ROLE app_user"))
    tid = _tenant_cv.get()
    if tid is not None:
        connection.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tid)},
        )
    if _bypass_cv.get():
        connection.execute(
            text("SELECT set_config('app.bypass_rls', 'true', true)")
        )


async def get_db(x_tenant_id: str | None = Header(default=None)):
    """FastAPI dependency：開 AsyncSession 並把 tenant_id 放進 contextvar。
    after_begin event listener 會讀取 contextvar 套用 SET LOCAL 到 DB。"""
    token = _tenant_cv.set(int(x_tenant_id) if x_tenant_id else None)
    try:
        async with async_session() as session:
            yield session
    finally:
        _tenant_cv.reset(token)
