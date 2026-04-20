import base64
import hashlib
import hmac
import os

import httpx

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
LINE_API_BASE = "https://api.line.me/v2/bot"
LINE_API_DATA_BASE = "https://api-data.line.me/v2/bot"  # image / file content 是不同 host


def verify_line_signature(body: bytes, signature: str) -> bool:
    """驗證 LINE webhook body 簽章。LINE_CHANNEL_SECRET 空字串時一律回 False
    （避免 dev 環境誤放行）。"""
    if not LINE_CHANNEL_SECRET:
        return False
    hash_ = hmac.new(
        LINE_CHANNEL_SECRET.encode(), body, hashlib.sha256
    ).digest()
    return base64.b64encode(hash_).decode() == signature


async def push_message(line_uuid: str, messages: list[dict]) -> bool:
    """Push（主動發訊）—— 會消耗 OA 的發訊額度。能用 reply_message 就先 reply。"""
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


async def reply_message(reply_token: str, messages: list[dict]) -> bool:
    """Reply（回覆 webhook event）—— 不消耗 push 額度，但 reply_token 僅限
    event 觸發後 30 秒內使用、只能用一次。適合 webhook 回覆「已收到」「權限
    不足」之類的即時反饋。"""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LINE_API_BASE}/message/reply",
            headers={
                "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
                "Content-Type": "application/json",
            },
            json={"replyToken": reply_token, "messages": messages},
        )
        return resp.status_code == 200


async def download_content(message_id: str) -> bytes:
    """從 LINE 拉 image / file / audio / video message 的 binary content。
    image/jpeg 是最常見的 case。30 秒 timeout（大檔案 / 網路慢）。"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{LINE_API_DATA_BASE}/message/{message_id}/content",
            headers={"Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}"},
        )
        resp.raise_for_status()
        return resp.content


def text_message(text: str) -> dict:
    """包一個 LINE text message object，省去每次手寫 {'type':'text',...}。"""
    return {"type": "text", "text": text}
