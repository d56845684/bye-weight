"""Integrations API — provider spec / 實際連線 / OAuth / 動態選項。

Endpoints:
  GET  /integrations                          列出當前 tenant 的連線狀態
  GET  /integrations/providers                列 provider spec（彈窗渲染 form 用）
  GET  /integrations/{kind}/connect           → 302 到 provider 授權頁；沒設 CLIENT_ID 走 mock
  GET  /integrations/{kind}/callback          provider 回傳 code → 換 token → 302 回前端
  POST /integrations/{kind}/disconnect        清 tokens，connected=false
  PUT  /integrations/{kind}                   更新 config（偏好設定）
  GET  /integrations/{kind}/resources/{type}  動態選項（OAuth 完成後呼叫 provider API）
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, rls_bypass
from deps import current_user
from models import Integration, IntegrationProvider, IntegrationOAuthState
from schemas.common import (
    IntegrationOut,
    IntegrationProviderOut,
    IntegrationConfigPatchRequest,
    DynamicOptionsOut,
    DynamicOption,
)
from services import oauth as oauth_svc

router = APIRouter(prefix="/integrations", tags=["integrations"])


# ═════════════════════════════════════════════════════════════════
# Spec & list
# ═════════════════════════════════════════════════════════════════
@router.get("/providers", response_model=list[IntegrationProviderOut])
async def list_providers(
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(IntegrationProvider)
        .where(IntegrationProvider.active.is_(True))
        .order_by(IntegrationProvider.sort_order.asc(), IntegrationProvider.id.asc())
    )).scalars().all()
    return [IntegrationProviderOut.model_validate(r) for r in rows]


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Integration).where(Integration.deleted_at.is_(None)).order_by(Integration.kind.asc())
    )).scalars().all()
    return [IntegrationOut.model_validate(r) for r in rows]


# ═════════════════════════════════════════════════════════════════
# OAuth connect / callback
# ═════════════════════════════════════════════════════════════════
@router.get("/{kind}/connect")
async def start_oauth(
    kind: str,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """啟動 OAuth 授權：
    - 設了 CLIENT_ID / SECRET → redirect 到 provider authorize URL
    - 沒設 → mock 模式，直接把該 integration 標為 connected 並回前端
    """
    provider = oauth_svc.get_provider(kind)
    if provider is None:
        raise HTTPException(404, f"unknown provider '{kind}'")

    # Mock 模式（dev 無 credentials）
    if not provider.configured():
        await _mock_connect(db, tenant_id=user["tenant_id"], kind=kind)
        return RedirectResponse(url=f"/kuji/integrations?connected={kind}&mock=1", status_code=302)

    # 真 OAuth
    state = oauth_svc.new_state()
    pkce_verifier = None
    pkce_challenge = None
    if provider.use_pkce:
        import base64, hashlib, secrets
        pkce_verifier = secrets.token_urlsafe(64)
        pkce_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(pkce_verifier.encode()).digest()
        ).decode().rstrip("=")

    db.add(IntegrationOAuthState(
        state=state, tenant_id=user["tenant_id"], user_id=user["user_id"], kind=kind,
        pkce_verifier=pkce_verifier, return_to="/kuji/integrations",
        expires_at=oauth_svc.state_expiry(),
    ))
    await db.commit()

    redirect_uri = oauth_svc.build_redirect_uri(kind)
    authorize_url = provider.build_authorize_url(state, redirect_uri, pkce_challenge)
    return RedirectResponse(url=authorize_url, status_code=302)


@router.get("/{kind}/callback")
async def oauth_callback(
    kind: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """provider 回傳後 → 換 token → 寫 DB → 導回前端。
    不走 auth_request；防 CSRF 靠 state + OAuth spec 設計。
    """
    qs = request.query_params
    code = qs.get("code")
    state = qs.get("state")
    error = qs.get("error")

    if error:
        return RedirectResponse(url=f"/kuji/integrations?error={error}&kind={kind}", status_code=302)
    if not code or not state:
        raise HTTPException(400, "missing code / state")

    provider = oauth_svc.get_provider(kind)
    if provider is None:
        raise HTTPException(404, f"unknown provider '{kind}'")

    with rls_bypass():
        st = (await db.execute(
            select(IntegrationOAuthState).where(IntegrationOAuthState.state == state)
        )).scalar_one_or_none()
    if st is None:
        raise HTTPException(400, "invalid or expired state")
    if st.kind != kind:
        raise HTTPException(400, "state kind mismatch")
    if st.expires_at < datetime.utcnow():
        raise HTTPException(410, "state expired")

    redirect_uri = oauth_svc.build_redirect_uri(kind)
    try:
        result = provider.exchange_code(code, redirect_uri, st.pkce_verifier)
    except Exception as e:
        with rls_bypass():
            await db.execute(delete(IntegrationOAuthState).where(IntegrationOAuthState.state == state))
            await db.commit()
        raise HTTPException(502, f"token exchange failed: {e}") from e

    with rls_bypass():
        existing = (await db.execute(
            select(Integration).where(
                Integration.tenant_id == st.tenant_id,
                Integration.kind == kind,
                Integration.deleted_at.is_(None),
            )
        )).scalar_one_or_none()

        expires_at = (datetime.utcnow() + timedelta(seconds=result.expires_in)) if result.expires_in else None

        if existing is None:
            row = Integration(
                tenant_id=st.tenant_id, kind=kind, connected=True,
                workspace_label=result.workspace_label,
                oauth_access_token=result.access_token,
                oauth_refresh_token=result.refresh_token,
                oauth_token_type=result.token_type,
                oauth_expires_at=expires_at,
                oauth_scope=result.scope,
                external_workspace_id=result.external_workspace_id,
                external_user_id=result.external_user_id,
                connected_at=datetime.utcnow(),
                created_by=st.user_id,
            )
            db.add(row)
        else:
            existing.connected = True
            existing.workspace_label = result.workspace_label or existing.workspace_label
            existing.oauth_access_token = result.access_token
            existing.oauth_refresh_token = result.refresh_token
            existing.oauth_token_type = result.token_type
            existing.oauth_expires_at = expires_at
            existing.oauth_scope = result.scope
            existing.external_workspace_id = result.external_workspace_id
            existing.external_user_id = result.external_user_id
            existing.connected_at = datetime.utcnow()

        await db.execute(delete(IntegrationOAuthState).where(IntegrationOAuthState.state == state))
        await db.commit()

    return RedirectResponse(url=f"{st.return_to}?connected={kind}", status_code=302)


@router.post("/{kind}/disconnect", response_model=IntegrationOut)
async def disconnect_integration(
    kind: str,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(Integration).where(Integration.kind == kind, Integration.deleted_at.is_(None))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, f"integration '{kind}' not connected")
    row.connected = False
    row.connected_at = None
    row.oauth_access_token = None
    row.oauth_refresh_token = None
    row.oauth_expires_at = None
    row.oauth_scope = None
    await db.commit()
    await db.refresh(row)
    return IntegrationOut.model_validate(row)


# ═════════════════════════════════════════════════════════════════
# Config update
# ═════════════════════════════════════════════════════════════════
@router.put("/{kind}", response_model=IntegrationOut)
async def update_config(
    kind: str,
    payload: IntegrationConfigPatchRequest,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = (await db.execute(
        select(IntegrationProvider).where(IntegrationProvider.kind == kind, IntegrationProvider.active.is_(True))
    )).scalar_one_or_none()
    if provider is None:
        raise HTTPException(404, f"provider '{kind}' not registered")

    row = (await db.execute(
        select(Integration).where(Integration.kind == kind, Integration.deleted_at.is_(None))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(400, f"'{kind}' not connected yet — run OAuth first")

    allowed_keys = {f["key"] for f in provider.fields}
    required_keys = {f["key"] for f in provider.fields if f.get("required") and f.get("type") != "info"}
    cleaned = {k: v for k, v in payload.config.items() if k in allowed_keys}
    missing = [k for k in required_keys if not cleaned.get(k)]
    if missing:
        raise HTTPException(422, f"missing required fields: {missing}")

    row.config = {**row.config, **cleaned}
    if payload.workspace_label is not None:
        row.workspace_label = payload.workspace_label
    await db.commit()
    await db.refresh(row)
    return IntegrationOut.model_validate(row)


# ═════════════════════════════════════════════════════════════════
# Dynamic options — mock 回 channels / databases / calendars 清單
# ═════════════════════════════════════════════════════════════════
@router.get("/{kind}/resources/{resource_type}", response_model=DynamicOptionsOut)
async def list_dynamic_options(
    kind: str,
    resource_type: str,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """MVP：所有 provider 都回 mock 選項。正式時依 kind 分派呼 provider API（用 oauth_access_token）。"""
    row = (await db.execute(
        select(Integration).where(Integration.kind == kind, Integration.deleted_at.is_(None), Integration.connected.is_(True))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(400, f"'{kind}' not connected yet")

    mock = _mock_dynamic_options(kind, resource_type)
    return DynamicOptionsOut(options=[DynamicOption(**o) for o in mock])


# ═════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════
async def _mock_connect(db: AsyncSession, tenant_id: int, kind: str):
    """沒 OAuth credentials → 直接標為 connected，oauth_* 留空。"""
    row = (await db.execute(
        select(Integration).where(Integration.kind == kind, Integration.deleted_at.is_(None))
    )).scalar_one_or_none()
    if row is None:
        row = Integration(
            tenant_id=tenant_id, kind=kind, connected=True,
            workspace_label=f"mock · {kind}",
            connected_at=datetime.utcnow(),
        )
        db.add(row)
    else:
        row.connected = True
        row.connected_at = datetime.utcnow()
        if not row.workspace_label:
            row.workspace_label = f"mock · {kind}"
    await db.commit()


def _mock_dynamic_options(kind: str, resource_type: str) -> list[dict]:
    K = (kind, resource_type)
    if K == ("notion", "databases"):
        return [
            {"value": "d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6", "label": "Product Tasks",  "hint": "Emily's workspace"},
            {"value": "a9b8c7d6e5f4a3b2c1d0e1f2a3b4c5d6", "label": "Acme OKRs",      "hint": "Emily's workspace"},
            {"value": "11112222333344445555666677778888", "label": "Meeting Notes", "hint": "Shared"},
        ]
    if K == ("slack", "channels"):
        return [
            {"value": "C01PRODUCT", "label": "#product",     "hint": "128 members"},
            {"value": "C01LEGAL",   "label": "#legal",       "hint": "8 members"},
            {"value": "C01ENG",     "label": "#engineering", "hint": "42 members"},
            {"value": "C01GENERAL", "label": "#general",     "hint": "all hands"},
        ]
    if K in (("gcal", "calendars"), ("gmeet", "calendars")):
        return [
            {"value": "primary",        "label": "Primary",      "hint": "emily@acme.com"},
            {"value": "team@acme.com",  "label": "Team Events"},
            {"value": "hr@acme.com",    "label": "HR · 1:1s"},
        ]
    return []
