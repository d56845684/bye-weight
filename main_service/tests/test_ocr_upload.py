"""OCR 上傳辨識的 unit tests。

模擬「使用者上傳一張圖 → 交給模型 → 拿回辨識結果」這條路徑，但用 mock provider
取代真 LLM（不花 Gemini 額度、不需網路、可在 CI 跑）。驗的是 ocr.py 這層：

  1. 上傳的 image bytes 真的有被當多模態輸入丟給模型（images=[...]）
  2. 模型回的髒資料（字串數值、字串陣列、缺欄位）被正規化成乾淨型別
  3. 模型不可用 / 回應無法解析 → raise，讓 ingest 層走 ocr_failed

真 Gemini + 真圖的 end-to-end 驗證另走 manual / integration（見對話紀錄）。
"""
from unittest.mock import AsyncMock

import pytest

import services.ocr as ocr


def _fake_llm(return_value):
    """做一個 provider 替身，complete_json 回指定值並記錄收到的參數。"""
    provider = AsyncMock()
    provider.complete_json = AsyncMock(return_value=return_value)
    return provider


@pytest.mark.asyncio
async def test_recognize_food_passes_uploaded_image_to_model(monkeypatch):
    provider = _fake_llm({
        "food_items": [{"name": "雞胸沙拉", "portion": "一份"}],
        "total_calories": 420, "total_protein": 35,
        "total_carbs": 20, "total_fat": 12,
        "ai_suggestion": "蛋白質充足",
    })
    monkeypatch.setattr(ocr, "get_llm", lambda: provider)

    image = b"\xff\xd8\xff-fake-jpeg-bytes"
    result = await ocr.recognize_food(image)

    # 上傳的圖有被當 image 輸入丟給模型
    provider.complete_json.assert_awaited_once()
    _, kwargs = provider.complete_json.call_args
    assert kwargs["images"] == [image]

    # 結果型別乾淨
    assert result["food_items"] == [{"name": "雞胸沙拉", "portion": "一份"}]
    assert result["total_calories"] == 420.0
    assert isinstance(result["total_calories"], float)


@pytest.mark.asyncio
async def test_recognize_food_normalizes_messy_model_output(monkeypatch):
    """模型回字串數值 + 字串品項 + 缺欄位 → 正規化後不會在下游寫 DB 時炸。"""
    provider = _fake_llm({
        "food_items": ["滷肉飯", {"name": "燙青菜", "portion": "一盤"}],
        "total_calories": "約 850 kcal",   # 夾單位字串
        "total_protein": None,             # 缺
        # total_carbs 整個沒回
        "total_fat": "30",
    })
    monkeypatch.setattr(ocr, "get_llm", lambda: provider)

    result = await ocr.recognize_food(b"jpg")

    assert result["total_calories"] == 850.0
    assert result["total_protein"] is None
    assert result["total_carbs"] is None
    assert result["total_fat"] == 30.0
    assert result["food_items"] == [
        {"name": "滷肉飯", "portion": None},
        {"name": "燙青菜", "portion": "一盤"},
    ]


@pytest.mark.asyncio
async def test_recognize_food_raises_when_model_unavailable(monkeypatch):
    """provider 回 None（無 key / 無法解析）→ raise，讓 ingest 走 ocr_failed。"""
    monkeypatch.setattr(ocr, "get_llm", lambda: _fake_llm(None))
    with pytest.raises(ValueError):
        await ocr.recognize_food(b"jpg")


@pytest.mark.asyncio
async def test_ocr_inbody_passes_image_and_normalizes(monkeypatch):
    provider = _fake_llm({
        "name": "王小明", "birth_date": "1990-01-01", "chart_no": "A001",
        "weight": "72.5 kg", "bmi": 24, "body_fat_pct": "18.3",
        "visceral_fat": "7", "muscle_segmental": {"la": 3.1},
    })
    monkeypatch.setattr(ocr, "get_llm", lambda: provider)

    image = b"inbody-jpeg"
    result = await ocr.ocr_inbody(image)

    _, kwargs = provider.complete_json.call_args
    assert kwargs["images"] == [image]
    # 數值欄位正規化
    assert result["weight"] == 72.5
    assert result["bmi"] == 24.0
    assert result["body_fat_pct"] == 18.3
    assert result["visceral_fat"] == 7.0
    # 非數值欄位原樣保留（segmental 交給 inbody_ingest._clean_seg）
    assert result["name"] == "王小明"
    assert result["muscle_segmental"] == {"la": 3.1}


@pytest.mark.asyncio
async def test_ocr_inbody_raises_when_model_unavailable(monkeypatch):
    monkeypatch.setattr(ocr, "get_llm", lambda: _fake_llm(None))
    with pytest.raises(ValueError):
        await ocr.ocr_inbody(b"jpg")
