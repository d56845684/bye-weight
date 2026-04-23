"""OAuth 2.0 pluggable provider 層。
每家 provider 實作一個 class（subclass OAuthProvider），
由 registry 依 kind 查找。

MVP 只實作 Notion（無 PKCE、無 refresh_token），其他 5 家先註冊 stub 走 mock 流程
（沒設 CLIENT_ID 的情況自動走 mock mode，方便 dev / demo 測前端設定彈窗）。

OAuth 流程：
    1. start(tenant, user, kind) → (authorize_url, state)
       backend 寫一筆 integration_oauth_states
    2. callback(state, code) → 換 token、寫 integrations、清 state row
       回 Integration 物件
    3. mock_connect(tenant, user, kind) → 非 OAuth 直接標記為 connected（dev 用）
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx


# ────────────────────────────────────────────────────────────────
# base provider
# ────────────────────────────────────────────────────────────────
@dataclass
class TokenExchangeResult:
    access_token: str
    refresh_token: str | None
    token_type: str | None
    expires_in: int | None           # seconds
    scope: str | None
    external_workspace_id: str | None
    external_user_id: str | None
    workspace_label: str | None


class OAuthProvider:
    kind: str = ""
    authorize_url: str = ""
    token_url: str = ""
    env_client_id: str = ""
    env_client_secret: str = ""
    default_scope: str = ""
    use_pkce: bool = False

    # --- hooks for subclasses ---
    def auth_params(self, state: str, redirect_uri: str, pkce_challenge: str | None) -> dict[str, str]:
        raise NotImplementedError

    def exchange_code(self, code: str, redirect_uri: str, pkce_verifier: str | None) -> TokenExchangeResult:
        raise NotImplementedError

    # --- common helpers ---
    def client_id(self) -> str:
        return os.getenv(self.env_client_id, "")

    def client_secret(self) -> str:
        return os.getenv(self.env_client_secret, "")

    def configured(self) -> bool:
        """env var 有設 → 走真 OAuth；沒設 → mock 模式。"""
        return bool(self.client_id() and self.client_secret())

    def build_authorize_url(self, state: str, redirect_uri: str, pkce_challenge: str | None) -> str:
        params = self.auth_params(state, redirect_uri, pkce_challenge)
        from urllib.parse import urlencode
        return f"{self.authorize_url}?{urlencode(params)}"


# ────────────────────────────────────────────────────────────────
# Notion
# ────────────────────────────────────────────────────────────────
class NotionProvider(OAuthProvider):
    kind = "notion"
    authorize_url = "https://api.notion.com/v1/oauth/authorize"
    token_url = "https://api.notion.com/v1/oauth/token"
    env_client_id = "KUJI_NOTION_CLIENT_ID"
    env_client_secret = "KUJI_NOTION_CLIENT_SECRET"
    # Notion 不用 scope
    use_pkce = False

    def auth_params(self, state: str, redirect_uri: str, pkce_challenge: str | None) -> dict[str, str]:
        return {
            "client_id": self.client_id(),
            "response_type": "code",
            "owner": "user",
            "state": state,
            "redirect_uri": redirect_uri,
        }

    def exchange_code(self, code: str, redirect_uri: str, pkce_verifier: str | None) -> TokenExchangeResult:
        import base64
        basic = base64.b64encode(f"{self.client_id()}:{self.client_secret()}".encode()).decode()
        resp = httpx.post(
            self.token_url,
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return TokenExchangeResult(
            access_token=data["access_token"],
            refresh_token=None,                            # Notion 不發 refresh_token
            token_type=data.get("token_type", "bearer"),
            expires_in=None,                               # Notion token 不過期
            scope=None,
            external_workspace_id=data.get("workspace_id"),
            external_user_id=data.get("owner", {}).get("user", {}).get("id"),
            workspace_label=data.get("workspace_name"),
        )


# ────────────────────────────────────────────────────────────────
# Stubs — 其他 5 家還沒真正實作；call start() 會走 mock 模式
# ────────────────────────────────────────────────────────────────
class _StubProvider(OAuthProvider):
    # env 不會設、configured() = False、一律走 mock
    def auth_params(self, state, redirect_uri, pkce_challenge): return {}
    def exchange_code(self, code, redirect_uri, pkce_verifier):
        raise NotImplementedError(f"{self.kind} OAuth flow not implemented")


class SlackProvider(_StubProvider):  kind = "slack"
class GCalProvider(_StubProvider):   kind = "gcal"
class TeamsProvider(_StubProvider):  kind = "teams"
class ZoomProvider(_StubProvider):   kind = "zoom"
class GMeetProvider(_StubProvider):  kind = "gmeet"


# ────────────────────────────────────────────────────────────────
# Registry
# ────────────────────────────────────────────────────────────────
_REGISTRY: dict[str, OAuthProvider] = {
    "notion": NotionProvider(),
    "slack":  SlackProvider(),
    "gcal":   GCalProvider(),
    "teams":  TeamsProvider(),
    "zoom":   ZoomProvider(),
    "gmeet":  GMeetProvider(),
}


def get_provider(kind: str) -> OAuthProvider | None:
    return _REGISTRY.get(kind)


# ────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────
def new_state() -> str:
    return secrets.token_urlsafe(32)


def state_expiry(minutes: int = 10) -> datetime:
    return datetime.utcnow() + timedelta(minutes=minutes)


def build_redirect_uri(kind: str) -> str:
    """OAuth redirect URI。優先用 KUJI_OAUTH_REDIRECT_BASE env（prod 必設，ngrok 測試也用）。
    未設則用 host header（dev 本機）。"""
    base = os.getenv("KUJI_OAUTH_REDIRECT_BASE", "http://localhost:8080")
    return f"{base}/kuji/api/v1/integrations/{kind}/callback"
