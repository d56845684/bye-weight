"""LINE webhook sender resolver：以 LINE UUID 反查 auth_service 的 internal
endpoint 決定 {user_id, role, tenant_id}。

為什麼不直接連 auth_db？
- auth_service 是 users / roles / policies 的唯一擁有者。其他 service 走 SQL 會
  繞過：業務規則（active / 軟刪邏輯）、稽核（誰查了誰）、schema 版本相容層。
- auth_service 可以隨時改 users schema 或 users 的判定規則，只要 API 契約穩定；
  直連 SQL 的 service 就會靜默壞掉。
- LINE webhook 是 no-auth public endpoint，拿不到 user JWT，用 shared secret
  header 打 /auth/internal/users/by-line-uuid；auth_service 端 fail-close（token
  空字串或不符 → 401）。
"""
import os
from dataclasses import dataclass

import httpx

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth_service:8001")
INTERNAL_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")


@dataclass(frozen=True)
class LineSender:
    user_id: int
    role: str
    tenant_id: int
    display_name: str | None


async def resolve_sender(line_uuid: str) -> LineSender | None:
    """以 LINE UUID 呼叫 auth_service internal endpoint 反查 user。
    找不到 / non-active / 軟刪 / 服務不可達 → None（caller 決定怎麼回 LINE）。
    """
    if not line_uuid:
        return None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{AUTH_SERVICE_URL}/auth/internal/users/by-line-uuid",
                params={"uuid": line_uuid},
                headers={"X-Internal-Token": INTERNAL_TOKEN},
            )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        # 401 (token 錯) / 404 (查無 user) / 5xx 都當 None；caller 的錯誤訊息覆蓋
        return None
    try:
        data = resp.json()
    except ValueError:
        return None
    return LineSender(
        user_id=data["user_id"],
        role=data["role"],
        tenant_id=data["tenant_id"],
        display_name=data.get("display_name"),
    )
