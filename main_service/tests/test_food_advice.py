"""food_advice 的 unit tests — 不打 Gemini，只驗 rule-based fallback。

`_traffic_light` 是純函數，能直接驗閾值；`_fallback` 也是純文字組裝。
真實 Gemini 行為留給 manual / integration sweep。
"""
import pytest

from services.food_advice import _fallback, _traffic_light, generate_advice


def test_traffic_light_no_goal_yellow():
    assert _traffic_light(meal_kcal=500, after_kcal=500, goal=None) == ("yellow", None)


def test_traffic_light_goal_no_daily_kcal_yellow():
    assert _traffic_light(meal_kcal=500, after_kcal=500, goal={"daily_kcal": None}) \
        == ("yellow", None)


def test_traffic_light_green_under_80pct():
    light, remaining = _traffic_light(meal_kcal=400, after_kcal=800, goal={"daily_kcal": 2000})
    assert light == "green"
    assert remaining == 1200


def test_traffic_light_yellow_80_to_110pct():
    light, _ = _traffic_light(meal_kcal=400, after_kcal=1700, goal={"daily_kcal": 2000})
    assert light == "yellow"


def test_traffic_light_red_over_110pct():
    light, _ = _traffic_light(meal_kcal=400, after_kcal=2300, goal={"daily_kcal": 2000})
    assert light == "red"


def test_traffic_light_single_meal_more_than_half_daily_is_red():
    # 1200 kcal / 2000 daily → 單餐占 60% 直接 red，即使整日累計還沒超
    light, _ = _traffic_light(meal_kcal=1200, after_kcal=1200, goal={"daily_kcal": 2000})
    assert light == "red"


def test_fallback_green_mentions_remaining():
    msg = _fallback("green", remaining=1200)
    assert "1200" in msg


def test_fallback_red_no_remaining_in_text():
    """red 狀態不顯示剩餘額度（已超 / 接近超），語氣以節制為主。"""
    msg = _fallback("red", remaining=0)
    assert "0" not in msg  # 不秀剩餘
    assert any(w in msg for w in ("超出", "克制", "清淡"))


class _NullLLM:
    """provider 不可用：complete_json 一律回 None → generate_advice 走 fallback。"""
    available = False

    async def complete_json(self, prompt, *, images=None):
        return None


@pytest.mark.asyncio
async def test_generate_advice_returns_shape_without_llm(monkeypatch):
    """LLM 不可用 → 走 fallback；仍回 advice/traffic_light/remaining_kcal 三 key。"""
    monkeypatch.setattr("services.food_advice.get_llm", lambda: _NullLLM())
    out = await generate_advice(
        meal={"total_calories": 400},
        today_totals={"kcal": 200},
        goal={"daily_kcal": 2000},
    )
    assert set(out.keys()) == {"advice", "traffic_light", "remaining_kcal"}
    assert out["traffic_light"] == "green"
    assert out["remaining_kcal"] == 1400
    assert out["advice"]  # non-empty


@pytest.mark.asyncio
async def test_generate_advice_uses_llm_when_available(monkeypatch):
    """provider 回 advice → 採用它，不走 fallback。"""
    class _LLM:
        available = True
        async def complete_json(self, prompt, *, images=None):
            return {"advice": "蛋白質充足，下一餐補點蔬菜。"}

    monkeypatch.setattr("services.food_advice.get_llm", lambda: _LLM())
    out = await generate_advice(
        meal={"total_calories": 400, "food_items": [{"name": "雞胸"}]},
        today_totals={"kcal": 200},
        goal={"daily_kcal": 2000},
    )
    assert out["advice"] == "蛋白質充足，下一餐補點蔬菜。"


@pytest.mark.asyncio
async def test_generate_advice_survives_string_calories(monkeypatch):
    """防呆：即使 meal 數值是字串（理論上已被 ocr 正規化），也不該 crash。"""
    monkeypatch.setattr("services.food_advice.get_llm", lambda: _NullLLM())
    out = await generate_advice(
        meal={"total_calories": "約500"},  # _num 容錯 → 0.0
        today_totals={"kcal": 0},
        goal={"daily_kcal": 2000},
    )
    assert out["traffic_light"] in {"green", "yellow", "red"}
