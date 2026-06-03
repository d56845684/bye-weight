"""Provider 介面 + 共用 JSON 解析。"""
import json
import logging
from abc import ABC, abstractmethod

log = logging.getLogger(__name__)


class LLMProvider(ABC):
    """多模態 / 文字 LLM 的最小介面。目前只需要「給 prompt（可附圖）拿 JSON」。"""

    @property
    @abstractmethod
    def available(self) -> bool:
        """provider 是否可用（例如 API key 有設）。False 時 complete_json 一律回 None。"""
        ...

    @abstractmethod
    async def complete_json(
        self, prompt: str, *, images: list[bytes] | None = None
    ) -> dict | None:
        """跑模型並從回應中解析出一個 JSON object。

        - `images`：可選的 image bytes（image/jpeg）做多模態輸入。
        - 回傳解析後的 dict；provider 不可用、呼叫失敗、或回應無法解析成 JSON
          → 回 None（呼叫端決定怎麼降級，不在這裡 raise）。
        - 實作**必須**把 blocking SDK 呼叫丟到 thread，不可阻塞 event loop。
        """
        ...


def extract_json(text: str | None) -> dict | None:
    """從 LLM 回應字串拉出第一個 JSON object。

    容錯涵蓋常見格式：
      - 純 JSON：`{...}`
      - ```json ... ``` 或 ``` ... ```（含**單行** ```{...}``` —— 早期 split('\\n')
        實作在這種情況會 IndexError）
      - JSON 前後夾雜說明文字

    作法：抓第一個 `{` 到最後一個 `}` 的區段再 json.loads，避開 fence / 前後綴雜訊。
    解析不出來 → None。
    """
    if not text:
        return None
    s = text.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        result = json.loads(s[start : end + 1])
    except json.JSONDecodeError as e:
        log.warning("LLM response not valid JSON: %s", e)
        return None
    return result if isinstance(result, dict) else None
