"""LINE Messaging API webhook entry。

Trigger 來源：LINE 平台 push 每個 OA 事件到這裡。**不經 Nginx auth_request**，
進來都是 anonymous；靠 X-Line-Signature HMAC 驗證是真的 LINE 送的。身份從
event.source.userId（LINE UUID）反查 auth_db.users 決定。

Image message 依 sender role 分支：
  - patient                          → 食物攝取（food_ingest，AI 認圖 + 個人化建議）
  - staff / nutritionist / admin     → InBody 攝取（inbody_ingest，OCR + 病患比對）
  - 其他角色 / 未綁定                  → 回拒絕訊息

非 image event（follow / unfollow / text / postback）先 no-op 忽略。
"""
import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from database import session_context
from services.food_ingest import ingest_food
from services.inbody_ingest import ingest_inbody
from services.line_sender import LineSender, resolve_sender
from utils.line import download_content, reply_message, text_message, verify_line_signature

router = APIRouter(prefix="/line", tags=["line"])
log = logging.getLogger(__name__)

# 哪些 role 可以透過 LINE 上傳 InBody。super_admin 在 system tenant，不適合；
# patient 走 food_ingest 分支不在這集合。
INBODY_UPLOAD_ROLES = {"staff", "nutritionist", "admin"}


@router.post("/webhook")
async def line_webhook(request: Request, background_tasks: BackgroundTasks):
    """LINE Webhook 端點。驗簽 → parse → 把每個 event 丟背景處理 → 立刻回 200。

    為什麼要立刻回 200 + 背景處理：
      圖片 event 要做 下載圖 → Gemini OCR → Gemini 建議 → 寫 DB → reply，
      動輒 10 秒以上。LINE 等不到回應會主動斷線（nginx 記 HTTP 499），
      請求被取消 → OCR 白跑、DB 沒寫、reply 沒發。所以同步處理絕對不行。
      reply_token 有效約 1 分鐘，背景數秒內處理完仍來得及回覆。

    LINE 對非 2xx 會重送；我們一律回 200，重送只會重複 OCR 浪費額度。
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
        background_tasks.add_task(_handle_event_bg, event)

    return {"status": "ok"}


async def _handle_event_bg(event: dict) -> None:
    """背景 wrapper：單一 event 掛掉不擋別的 event，也不影響已回給 LINE 的 200。"""
    try:
        await _handle_event(event)
    except Exception as e:
        log.exception("line event handler failed: %s", e)


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
    if sender.role != "patient" and sender.role not in INBODY_UPLOAD_ROLES:
        await _reply(reply_token, f"您的角色（{sender.role}）無權上傳圖片。")
        return

    # 2. 拉圖
    try:
        image_bytes = await download_content(message_id)
    except Exception as e:
        log.warning("download LINE content failed: %s", e)
        await _reply(reply_token, "取得圖片失敗，請稍後再試。")
        return

    # 3. 依 role 分流（context 設好 tenant_id / user_id，RLS + audit 才對得上）
    async with session_context(tenant_id=sender.tenant_id, user_id=sender.user_id) as db:
        if sender.role == "patient":
            result = await ingest_food(
                db,
                sender_user_id=sender.user_id,
                tenant_id=sender.tenant_id,
                image_bytes=image_bytes,
            )
            reply_text = _format_food_reply(result, sender)
        else:
            result = await ingest_inbody(
                db,
                uploader_user_id=sender.user_id,
                tenant_id=sender.tenant_id,
                image_bytes=image_bytes,
            )
            reply_text = _format_ingest_reply(result, sender)

    await _reply(reply_token, reply_text)


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


# 用 emoji 對應 traffic_light，視覺上比文字短且夠直觀
_LIGHT_EMOJI = {"green": "🟢", "yellow": "🟡", "red": "🔴"}


def _format_food_reply(result: dict, sender: LineSender) -> str:
    status = result.get("status")
    if status == "no_profile":
        return "⚠️ 系統尚未建立您的病患資料，請先至 LIFF 完成註冊。"
    if status == "upload_failed":
        return "❌ 圖片上傳失敗，請稍後再試一次。"
    if status == "ocr_failed":
        return "📸 圖片已收到，但無法辨識食物內容，營養師會於後台補上。"
    if status != "logged":
        return "❌ 處理失敗，請聯繫管理員。"

    foods = "、".join(result.get("food_names") or []) or "（無法判讀品項）"
    light = _LIGHT_EMOJI.get(result.get("traffic_light") or "", "🟡")
    advice = result.get("advice") or ""

    # 數值 None safe；Numeric / int 都可 str()
    def _g(key: str) -> str:
        v = result.get(key)
        return "—" if v is None else f"{float(v):.0f}"

    lines = [
        f"{light} 已記錄 {sender.display_name or ''} 的餐點：{foods}".rstrip(),
        f"熱量 {_g('kcal')} kcal｜蛋白 {_g('protein')}g｜碳水 {_g('carbs')}g｜脂肪 {_g('fat')}g",
    ]
    remaining = result.get("remaining_kcal")
    if remaining is not None:
        lines.append(f"今日剩餘 {remaining} kcal")
    if advice:
        lines.append(advice)
    return "\n".join(lines)
