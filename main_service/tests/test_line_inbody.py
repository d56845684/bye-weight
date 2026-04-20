"""LINE webhook → InBody ingestion dispatch 的 mock-based tests。

不碰真的 LINE API、不打 Gemini、不寫 DB；只驗 dispatch 邏輯是否對：
  1. staff 傳 image → 叫 ingest、reply 「已為 xxx 記錄」
  2. patient 傳 image → 不 ingest、reply 「無權」
  3. 未綁定 LINE UUID → 不 ingest、reply 「尚未綁定」
  4. ambiguous 結果 → reply 「找到 N 位同名」
  5. unmatched 結果 → reply 「查無病患」
  6. OCR 失敗 → reply 「無法辨識」
  7. 非 image 類型 event（follow / text 等）→ 靜默 no-op，reply 0 次

DB 寫入、OCR 這些下游由 services.inbody_ingest 直接 mock，不在本 suite 驗；
之後若要驗 ingest 真的寫 DB，寫成 integration-style .sh。
"""
import json
from unittest.mock import AsyncMock

import pytest

from services.line_sender import LineSender


def _image_event(line_uuid: str = "Ustaff", message_id: str = "msg-1",
                 reply_token: str = "reply-1") -> dict:
    return {
        "events": [
            {
                "type": "message",
                "replyToken": reply_token,
                "source": {"type": "user", "userId": line_uuid},
                "message": {"type": "image", "id": message_id},
            }
        ]
    }


def _text_sent(reply_spy: AsyncMock) -> str:
    """從 reply_message mock 取第一個 call 的 text body。"""
    reply_spy.assert_called_once()
    _, args, kwargs = reply_spy.mock_calls[0]
    messages = args[1] if len(args) > 1 else kwargs.get("messages", [])
    return messages[0]["text"]


def _bypass_signature(monkeypatch):
    monkeypatch.setattr(
        "routers.line_webhook.verify_line_signature",
        lambda body, sig: True,
    )


@pytest.fixture
def reply_spy(monkeypatch):
    spy = AsyncMock(return_value=True)
    monkeypatch.setattr("routers.line_webhook.reply_message", spy)
    return spy


@pytest.mark.asyncio
async def test_staff_upload_matched(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=10, role="staff", tenant_id=1, display_name="護理師")),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content",
        AsyncMock(return_value=b"jpg-bytes"),
    )
    ingest_spy = AsyncMock(return_value={
        "status": "matched", "patient_id": 42, "patient_name": "王小明",
    })
    monkeypatch.setattr("routers.line_webhook.ingest_inbody", ingest_spy)

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x", "Content-Type": "application/json"})

    assert resp.status_code == 200
    ingest_spy.assert_called_once()
    assert "已為 王小明" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_patient_role_blocked(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=5, role="patient", tenant_id=1, display_name="病患")),
    )
    dl_spy = AsyncMock(return_value=b"jpg")
    ingest_spy = AsyncMock()
    monkeypatch.setattr("routers.line_webhook.download_content", dl_spy)
    monkeypatch.setattr("routers.line_webhook.ingest_inbody", ingest_spy)

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    dl_spy.assert_not_called()
    ingest_spy.assert_not_called()
    assert "無權" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_unknown_sender(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=None),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event("Uunknown")).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    assert "尚未綁定" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_ambiguous_match(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=10, role="nutritionist", tenant_id=1, display_name="營養師")),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    monkeypatch.setattr(
        "routers.line_webhook.ingest_inbody",
        AsyncMock(return_value={"status": "ambiguous", "candidates": [1, 2, 3]}),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    assert "3 位同名" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_unmatched(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=10, role="staff", tenant_id=1, display_name=None)),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    monkeypatch.setattr(
        "routers.line_webhook.ingest_inbody",
        AsyncMock(return_value={"status": "unmatched", "ocr_name": "張三"}),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    assert "張三" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_ocr_failed(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=10, role="staff", tenant_id=1, display_name=None)),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    monkeypatch.setattr(
        "routers.line_webhook.ingest_inbody",
        AsyncMock(return_value={"status": "ocr_failed", "reason": "timeout"}),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    assert "無法辨識" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_text_message_ignored(client, monkeypatch, reply_spy):
    """非 image event → dispatcher 靜默 no-op，不 reply、不 ingest。"""
    _bypass_signature(monkeypatch)
    resolve_spy = AsyncMock()
    monkeypatch.setattr("routers.line_webhook.resolve_sender", resolve_spy)
    monkeypatch.setattr("routers.line_webhook.ingest_inbody", AsyncMock())

    text_event = {
        "events": [{
            "type": "message",
            "replyToken": "r",
            "source": {"type": "user", "userId": "U1"},
            "message": {"type": "text", "id": "m", "text": "hello"},
        }]
    }

    resp = await client.post("/line/webhook",
                             content=json.dumps(text_event).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    resolve_spy.assert_not_called()
    reply_spy.assert_not_called()
