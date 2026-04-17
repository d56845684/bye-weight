from fastapi import APIRouter, Request, HTTPException

from utils.line import verify_line_signature

router = APIRouter(prefix="/line", tags=["line"])


@router.post("/webhook")
async def line_webhook(request: Request):
    """LINE Webhook 端點（不經過 Nginx auth_request，由 LINE signature 驗證）"""
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")

    if not verify_line_signature(body, signature):
        raise HTTPException(403, "invalid signature")

    # TODO: 解析 LINE event 並路由處理
    # - 圖片訊息 → InBody OCR 或食物辨識
    # - 文字訊息 → 指令解析
    return {"status": "ok"}
