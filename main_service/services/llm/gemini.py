"""Google Gemini provider。"""
import asyncio
import logging

import google.generativeai as genai

from services.llm.base import LLMProvider, extract_json

log = logging.getLogger(__name__)


class GeminiProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        self._model = None
        if api_key:
            genai.configure(api_key=api_key)
            self._model = genai.GenerativeModel(model)
        else:
            log.warning("GEMINI_API_KEY not set; Gemini provider disabled (complete_json → None)")

    @property
    def available(self) -> bool:
        return self._model is not None

    async def complete_json(
        self, prompt: str, *, images: list[bytes] | None = None
    ) -> dict | None:
        if self._model is None:
            return None

        parts: list = [prompt]
        for img in images or []:
            parts.append({"mime_type": "image/jpeg", "data": img})

        try:
            # generate_content 是同步 blocking call —— 丟到 thread，否則會卡住整個
            # event loop（一張圖辨識動輒數秒，會拖垮同 worker 的其他請求）。
            resp = await asyncio.to_thread(self._model.generate_content, parts)
        except Exception as e:
            log.warning("gemini generate_content failed: %s", e)
            return None

        return extract_json(getattr(resp, "text", None))
