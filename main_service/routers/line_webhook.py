"""LINE Messaging API webhook entry。

Trigger 來源：LINE 平台 push 每個 OA 事件到這裡。**不經 Nginx auth_request**，
進來都是 anonymous；靠 X-Line-Signature HMAC 驗證是真的 LINE 送的。身份從
event.source.userId（LINE UUID）反查 auth_db.users 決定。

目前只 dispatch image message 到 InBody ingestion。其他 event（follow /
unfollow / text / group message / postback）先 no-op 忽略，之後要擴再加。
"""
import json
import logging

from fastapi import APIRouter, HTTPException, Request

from database import session_context
from services.inbody_ingest import ingest_inbody
from services.line_sender import LineSender, resolve_sender
from utils.line import download_content, reply_message, text_message, verify_line_signature

router = APIRouter(prefix="/line", tags=["line"])
log = logging.getLogger(__name__)

# 哪些 role 可以透過 LINE 上傳 InBody。super_admin 在 system tenant，不適合；
# patient 不應該自己傳 InBody（測量結果要員工執行 InBody 機台後上傳）。
INBODY_UPLOAD_ROLES = {"staff", "nutritionist", "admin"}


@router.post("/webhook")
async def line_webhook(request: Request):
    """LINE Webhook 端點。body → parse events → dispatch。

    Webhook 一律回 200 就算 —— LINE 對非 2xx 會重送，但我們已經吃進 OCR queue
    了，重送只會重複 OCR 浪費額度。內部失敗放進 log 跟 inbody_pending。
    """
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")

    if not verify_line_signature(body, signature):
        raise HTTPException(403, "invalid signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "invalid JSON")

    for event in payload.get("events", []):
        try:
            await _handle_event(event)
        except Exception as e:
            # 單一 event 掛掉不擋別的 event；webhook 還是回 200 給 LINE。
            log.exception("line event handler failed: %s", e)

    return {"status": "ok"}


async def _handle_event(event: dict) -> None:
    """單一 event dispatch。目前只處理 1:1 chat 的 image message。"""
    if event.get("type") != "message":
        return  # follow / unfollow / postback 等暫不處理

    message = event.get("message") or {}
    if message.get("type") != "image":
        return

    # source.type == 'user'（1:1）才處理；group / room 情境暫不支援
    source = event.get("source") or {}
    if source.get("type") != "user":
        return

    line_uuid = source.get("userId", "")
    reply_token = event.get("replyToken", "")
    message_id = message.get("id", "")

    if not line_uuid or not message_id:
        return

    # 1. 反查 sender 身份
    sender = await resolve_sender(line_uuid)
    if sender is None:
        await _reply(reply_token, "您的 LINE 尚未綁定本系統，請向診所索取綁定連結。")
        return
    if sender.role not in INBODY_UPLOAD_ROLES:
        await _reply(reply_token, f"您的角色（{sender.role}）無權上傳 InBody 報告。")
        return

    # 2. 拉圖
    try:
        image_bytes = await download_content(message_id)
    except Exception as e:
        log.warning("download LINE content failed: %s", e)
        await _reply(reply_token, "取得圖片失敗，請稍後再試。")
        return

    # 3. 跑 ingest（context 設好 tenant_id / user_id，RLS + audit 才對得上）
    async with session_context(tenant_id=sender.tenant_id, user_id=sender.user_id) as db:
        result = await ingest_inbody(
            db,
            uploader_user_id=sender.user_id,
            tenant_id=sender.tenant_id,
            image_bytes=image_bytes,
        )

    await _reply(reply_token, _format_ingest_reply(result, sender))


async def _reply(reply_token: str, text: str) -> None:
    """回一則文字訊息給 LINE sender；reply_token 失效或沒設就靜默跳過。"""
    if not reply_token:
        return
    try:
        await reply_message(reply_token, [text_message(text)])
    except Exception as e:
        log.warning("line reply failed: %s", e)


def _format_ingest_reply(result: dict, sender: LineSender) -> str:
    status = result.get("status")
    if status == "matched":
        name = result.get("patient_name") or f"#{result['patient_id']}"
        return f"✅ 已為 {name} 記錄 InBody 資料，病患可在 LIFF 查看。"
    if status == "ambiguous":
        n = len(result.get("candidates", []))
        return f"⚠️ 找到 {n} 位同名病患，請至後台人工確認歸屬。"
    if status == "unmatched":
        ocr_name = result.get("ocr_name") or "（無法辨識姓名）"
        return f"⚠️ 在您的診所查無病患「{ocr_name}」，已進入待確認清單。"
    if status == "ocr_failed":
        return "❌ 無法辨識圖片內容，請確認照片清晰、是否為 InBody 報告。"
    return "❌ 處理失敗，請聯繫管理員。"
