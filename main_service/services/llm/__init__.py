"""LLM provider 抽象層。

對 main_service 來說，所有「叫一個多模態 / 文字模型、要它回 JSON」的需求都走
這裡的 `get_llm().complete_json(...)`，不直接碰任何 vendor SDK。好處：

- 換 provider（Gemini → OpenAI / Claude / 自架）只動 `services/llm/`，呼叫端不改。
- blocking SDK call 一律在 provider 內 `asyncio.to_thread`，呼叫端不會卡 event loop。
- JSON 解析（含 ```fence 容錯）集中一處，不會每個呼叫端各寫一份還寫錯。

設定：環境變數 `LLM_PROVIDER`（預設 `gemini`）。各 provider 自己讀它要的 key
（Gemini 讀 `GEMINI_API_KEY`）。
"""
import os
from functools import lru_cache

from services.llm.base import LLMProvider, extract_json
from services.llm.gemini import GeminiProvider

__all__ = ["get_llm", "LLMProvider", "extract_json"]


@lru_cache(maxsize=1)
def get_llm() -> LLMProvider:
    """回傳設定指定的 LLM provider（process 內單例）。

    未知 provider 名 → 直接 raise，讓設定錯誤在啟動 / 第一次呼叫時就炸出來，
    不要默默 fallback 成別的 provider。
    """
    name = os.getenv("LLM_PROVIDER", "gemini").strip().lower()
    if name == "gemini":
        return GeminiProvider(
            api_key=os.getenv("GEMINI_API_KEY", ""),
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        )
    raise ValueError(f"unknown LLM_PROVIDER={name!r} (supported: gemini)")
