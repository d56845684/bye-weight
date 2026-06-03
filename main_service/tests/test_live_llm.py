"""實際打 LLM API 的 live 測試（會真的呼叫 Gemini、花額度、需網路）。

**預設跳過**，避免污染一般單元測試 / CI。要跑必須兩個條件都成立：
  - 環境變數 RUN_LIVE_LLM=1（明確 opt-in）
  - GEMINI_API_KEY 有設

跑法（docker-only，金鑰從 .env.docker 帶入）：
  docker run --rm -v "$PWD/main_service":/app -w /app \\
    --env-file main_service/.env.docker -e RUN_LIVE_LLM=1 \\
    python:3.11-slim sh -c \\
    "pip install -q -r requirements.txt && python -m pytest tests/test_live_llm.py -v -s"

驗的是真實 pipeline：image bytes → provider.to_thread → Gemini 多模態 → extract_json
→ ocr 正規化。斷言只看「結構/型別合理」，不鎖定 LLM 會浮動的實際數值。
"""
import os
from pathlib import Path

import pytest

from services.ocr import ocr_inbody, recognize_food

_FIXTURE = Path(__file__).parent / "fixtures" / "sample-inbody.jpg"

# 兩個 gate 任一不滿足就整個 module 跳過
pytestmark = [
    pytest.mark.skipif(
        not os.getenv("RUN_LIVE_LLM"),
        reason="live LLM test：設 RUN_LIVE_LLM=1 才跑（會真的打 API）",
    ),
    pytest.mark.skipif(
        not os.getenv("GEMINI_API_KEY"),
        reason="需要 GEMINI_API_KEY",
    ),
]


def _image_bytes() -> bytes:
    assert _FIXTURE.exists(), f"找不到 fixture：{_FIXTURE}"
    return _FIXTURE.read_bytes()


@pytest.mark.asyncio
async def test_live_ocr_inbody_real_gemini():
    """真打 Gemini 辨識 InBody 樣本報告，回正規化 dict。"""
    result = await ocr_inbody(_image_bytes())
    print("\n[live ocr_inbody] =>", result)

    assert isinstance(result, dict)
    numeric_fields = ("weight", "bmi", "body_fat_pct", "muscle_mass", "metabolic_rate")
    # 至少讀到一個數值欄位（證明真的有辨識，且 _to_num 正規化成 float）
    got = [f for f in numeric_fields if isinstance(result.get(f), float)]
    assert got, f"沒有任何數值欄位被辨識出來：{result}"


@pytest.mark.asyncio
async def test_live_recognize_food_real_gemini():
    """真打 Gemini 食物辨識路徑（用 InBody 圖只為打通 API，重點驗回傳結構/型別）。"""
    result = await recognize_food(_image_bytes())
    print("\n[live recognize_food] =>", result)

    assert isinstance(result, dict)
    assert isinstance(result["food_items"], list)  # _normalize_items 一定回 list
    for key in ("total_calories", "total_protein", "total_carbs", "total_fat"):
        v = result[key]
        assert v is None or isinstance(v, float)  # 正規化後只會是 float 或 None
