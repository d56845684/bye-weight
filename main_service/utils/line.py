import hashlib
import hmac
import base64
import os

import httpx

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
LINE_API_BASE = "https://api.line.me/v2/bot"


def verify_line_signature(body: bytes, signature: str) -> bool:
    hash_ = hmac.new(
        LINE_CHANNEL_SECRET.encode(), body, hashlib.sha256
    ).digest()
    return base64.b64encode(hash_).decode() == signature


async def push_message(line_uuid: str, messages: list[dict]) -> bool:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LINE_API_BASE}/message/push",
            headers={
                "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
                "Content-Type": "application/json",
            },
            json={"to": line_uuid, "messages": messages},
        )
        return resp.status_code == 200
