"""LINE webhook → 食物攝取 dispatch 的 mock-based tests。

不打 LINE、不打 Gemini、不寫 DB；只驗 webhook → role 分支 → ingest_food →
reply 文字組裝對不對。real DB 流程交給 inline integration .sh 腳本。

Cases:
  1. patient 傳 image → 走 food 分支、reply 內含食物名 + advice
  2. patient + no_profile → reply「尚未建立病患資料」
  3. patient + upload_failed → reply「上傳失敗」
  4. patient + ocr_failed → reply「無法辨識」
  5. staff 傳 image → 走 inbody 分支（不走 food），跟原本一致
  6. super_admin 傳 image → 「無權上傳圖片」
"""
import json
from unittest.mock import AsyncMock

import pytest

from services.line_sender import LineSender


def _image_event(line_uuid: str = "Upatient", message_id: str = "msg-1",
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


def _patient_sender():
    return LineSender(user_id=5, role="patient", tenant_id=1, display_name="王小明")


@pytest.mark.asyncio
async def test_patient_food_logged(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=_patient_sender()),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content",
        AsyncMock(return_value=b"jpg-bytes"),
    )
    ingest_spy = AsyncMock(return_value={
        "status": "logged",
        "patient_name": "王小明",
        "food_names": ["雞胸沙拉", "全麥吐司"],
        "kcal": 520.0,
        "protein": 32.0,
        "carbs": 45.0,
        "fat": 18.0,
        "advice": "蛋白質充足，碳水可再減半，搭配水分補充。",
        "traffic_light": "green",
        "remaining_kcal": 1130,
    })
    monkeypatch.setattr("routers.line_webhook.ingest_food", ingest_spy)
    inbody_spy = AsyncMock()
    monkeypatch.setattr("routers.line_webhook.ingest_inbody", inbody_spy)

    resp = await client.post(
        "/line/webhook",
        content=json.dumps(_image_event()).encode(),
        headers={"X-Line-Signature": "x", "Content-Type": "application/json"},
    )

    assert resp.status_code == 200
    ingest_spy.assert_called_once()
    inbody_spy.assert_not_called()
    text = _text_sent(reply_spy)
    assert "雞胸沙拉" in text
    assert "520" in text          # kcal
    assert "1130" in text         # remaining
    assert "蛋白質充足" in text   # advice
    assert "🟢" in text           # green light


@pytest.mark.asyncio
async def test_patient_no_profile(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=_patient_sender()),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    monkeypatch.setattr(
        "routers.line_webhook.ingest_food",
        AsyncMock(return_value={"status": "no_profile"}),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    assert "尚未建立" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_patient_upload_failed(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=_patient_sender()),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    monkeypatch.setattr(
        "routers.line_webhook.ingest_food",
        AsyncMock(return_value={"status": "upload_failed", "reason": "gcs down"}),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    assert "上傳失敗" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_patient_ocr_failed_still_logs(client, monkeypatch, reply_spy):
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=_patient_sender()),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    monkeypatch.setattr(
        "routers.line_webhook.ingest_food",
        AsyncMock(return_value={
            "status": "ocr_failed",
            "reason": "gemini 500",
            "patient_name": "王小明",
        }),
    )

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    text = _text_sent(reply_spy)
    assert "無法辨識" in text


@pytest.mark.asyncio
async def test_staff_still_goes_to_inbody(client, monkeypatch, reply_spy):
    """staff 傳 image 必須仍走 inbody，不能被 food 分支吃掉。"""
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=10, role="staff", tenant_id=1, display_name="護理師")),
    )
    monkeypatch.setattr(
        "routers.line_webhook.download_content", AsyncMock(return_value=b"jpg"))
    food_spy = AsyncMock()
    inbody_spy = AsyncMock(return_value={
        "status": "matched", "patient_id": 42, "patient_name": "王小明",
    })
    monkeypatch.setattr("routers.line_webhook.ingest_food", food_spy)
    monkeypatch.setattr("routers.line_webhook.ingest_inbody", inbody_spy)

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    food_spy.assert_not_called()
    inbody_spy.assert_called_once()
    assert "InBody" in _text_sent(reply_spy)


@pytest.mark.asyncio
async def test_super_admin_rejected(client, monkeypatch, reply_spy):
    """super_admin（system tenant）傳 image 都不該被當業務上傳。"""
    _bypass_signature(monkeypatch)
    monkeypatch.setattr(
        "routers.line_webhook.resolve_sender",
        AsyncMock(return_value=LineSender(
            user_id=1, role="super_admin", tenant_id=0, display_name=None)),
    )
    food_spy = AsyncMock()
    inbody_spy = AsyncMock()
    monkeypatch.setattr("routers.line_webhook.ingest_food", food_spy)
    monkeypatch.setattr("routers.line_webhook.ingest_inbody", inbody_spy)
    dl_spy = AsyncMock(return_value=b"jpg")
    monkeypatch.setattr("routers.line_webhook.download_content", dl_spy)

    resp = await client.post("/line/webhook",
                             content=json.dumps(_image_event()).encode(),
                             headers={"X-Line-Signature": "x"})

    assert resp.status_code == 200
    food_spy.assert_not_called()
    inbody_spy.assert_not_called()
    dl_spy.assert_not_called()
    assert "無權" in _text_sent(reply_spy)
