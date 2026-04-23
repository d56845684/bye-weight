from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Boolean, Text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models._mixin import AuditMixin


class IntegrationProvider(AuditMixin, Base):
    """靜態參考表：每家 provider 的顯示名稱、分類、OAuth URL、欄位 schema。
    多租戶共用；不走 RLS（spec 所有 tenant 都能讀）。admin 偶爾會調 fields / 停用 provider，
    因此仍保留 audit 欄位。
    """
    __tablename__ = "integration_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)  # source / destination
    description_zh: Mapped[str | None] = mapped_column(Text)
    description_en: Mapped[str | None] = mapped_column(Text)
    oauth_url: Mapped[str | None] = mapped_column(String(500))
    fields: Mapped[list] = mapped_column(postgresql.JSONB, nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Integration(AuditMixin, Base):
    """Tenant 實際連線：OAuth tokens + 使用者偏好 config。
    - oauth_access_token / oauth_refresh_token：runtime 跟 provider 講話用；MVP 存 plain text，
      正式環境應走 pgcrypto 或 KMS 加密。
    - config：使用者在設定彈窗選的偏好，keys 對應 IntegrationProvider.fields 裡的 field.key。
    """
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    workspace_label: Mapped[str | None] = mapped_column(String(200))
    config: Mapped[dict] = mapped_column(postgresql.JSONB, nullable=False, default=dict)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime)

    # OAuth 2.0
    oauth_access_token: Mapped[str | None]  = mapped_column(Text)
    oauth_refresh_token: Mapped[str | None] = mapped_column(Text)
    oauth_token_type: Mapped[str | None]    = mapped_column(String(20))
    oauth_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    oauth_scope: Mapped[str | None]           = mapped_column(Text)
    external_workspace_id: Mapped[str | None] = mapped_column(String(200))
    external_user_id: Mapped[str | None]      = mapped_column(String(200))

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class IntegrationOAuthState(Base):
    """OAuth 啟動時寫、callback 時驗、立即刪。10 分鐘自動過期。"""
    __tablename__ = "integration_oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    pkce_verifier: Mapped[str | None] = mapped_column(String(128))
    return_to: Mapped[str | None] = mapped_column(String(500))
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
