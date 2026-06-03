"""個人化飲食建議：吃完這餐之後，相對於病患目標表現如何 + 下一餐怎麼吃。

`recognize_food`（在 ocr.py）只負責認圖：吐出 food_items / 三大營養素 / 一段
generic 建議。那段建議跟病患的目標、當日攝取進度無關。真正臨床上有用的建議要看：

  - 病患的 daily_kcal / target_*_pct 目標（PatientGoal 最新生效一筆）
  - 今天已經吃進去的累計 kcal / 三大營養素
  - 這一餐新增的營養素

所以拆成獨立 service：webhook flow 跟未來 /food-logs/from-image API 都能呼叫，
prompt 設計也能單獨迭代不會碰到 OCR 主路徑。LLM 不可用 / 失敗 → 回 rule-based
fallback，不擋使用者寫入 food_log。模型呼叫走 services.llm provider。
"""
import json
import logging

from services.llm import get_llm

log = logging.getLogger(__name__)


def _num(v) -> float:
    """容錯轉 float（meal 數值理論上已被 recognize_food 正規化，這裡再保險一層）。"""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


async def generate_advice(
    *,
    meal: dict,
    today_totals: dict,
    goal: dict | None,
) -> dict:
    """為單一餐點產生個人化建議。

    Args:
        meal: 這一餐 recognize_food 結果（已含 total_calories / total_protein / ...）
        today_totals: 今天到目前累計 (含這餐前) {kcal, protein, carbs, fat}
        goal: 病患當前 PatientGoal 字典 {daily_kcal, target_*_pct, ...} 或 None

    Returns:
        {"advice": str, "traffic_light": "green"|"yellow"|"red", "remaining_kcal": int|None}

    Traffic light（依當日 kcal 進度，goal 存在時）：
      - red:    累計 > 110% daily_kcal，或單餐 kcal > 50% daily_kcal
      - yellow: 累計 80–110%（接近上限）
      - green:  累計 < 80%
    沒設 goal（或 daily_kcal 未填）→ 一律 yellow + 通用建議。
    """
    meal_kcal = _num(meal.get("total_calories"))
    after_kcal = _num(today_totals.get("kcal")) + meal_kcal

    light, remaining = _traffic_light(meal_kcal, after_kcal, goal)
    advice = await _llm_advice(meal, today_totals, goal, light, remaining)
    return {"advice": advice, "traffic_light": light, "remaining_kcal": remaining}


def _traffic_light(
    meal_kcal: float, after_kcal: float, goal: dict | None
) -> tuple[str, int | None]:
    if not goal or not goal.get("daily_kcal"):
        return "yellow", None
    daily = float(goal["daily_kcal"])
    pct = after_kcal / daily if daily > 0 else 0
    remaining = max(0, int(daily - after_kcal))
    if meal_kcal > daily * 0.5 or pct > 1.1:
        return "red", remaining
    if pct > 0.8:
        return "yellow", remaining
    return "green", remaining


async def _llm_advice(
    meal: dict, today_totals: dict, goal: dict | None, light: str, remaining: int | None
) -> str:
    """叫 LLM 拿建議文。provider 不可用 / 失敗 / 回應沒 advice → rule-based fallback。"""
    food_names = ", ".join(
        item.get("name", "") for item in (meal.get("food_items") or [])
        if isinstance(item, dict) and item.get("name")
    ) or "未識別食物"

    prompt = f"""你是一位減重診所的營養師助理。根據以下資料，給病患一段個人化飲食建議。

【這一餐】
食物：{food_names}
熱量：{meal.get('total_calories')} kcal
蛋白質：{meal.get('total_protein')} g
碳水：{meal.get('total_carbs')} g
脂肪：{meal.get('total_fat')} g

【今日累計（含這一餐）】
{today_totals.get('kcal', 0)} kcal / 蛋白質 {today_totals.get('protein', 0)}g / 碳水 {today_totals.get('carbs', 0)}g / 脂肪 {today_totals.get('fat', 0)}g

【病患目標】
{json.dumps(goal, ensure_ascii=False) if goal else "尚未設定"}

【號誌】{light}（green=尚可、yellow=接近上限、red=超標或單餐過大）
{f"今日剩餘額度：{remaining} kcal" if remaining is not None else ""}

請回傳 JSON：
{{"advice": "繁體中文建議，80 字以內，正向鼓勵語氣，避免醫療診斷字眼。若 red 須委婉提醒克制，若 green 可肯定。具體一點，不要空話。"}}
只回傳 JSON。"""

    data = await get_llm().complete_json(prompt)
    if data:
        advice = (data.get("advice") or "").strip()
        if advice:
            return advice
    return _fallback(light, remaining)


def _fallback(light: str, remaining: int | None) -> str:
    if light == "red":
        base = "今日攝取已超出目標，建議下一餐改清淡蔬菜湯或無糖飲品。"
    elif light == "yellow":
        base = "已接近今日熱量上限，下一餐可選低油料理並補充蔬菜。"
    else:
        base = "目前進度良好，記得補充足量水分與蔬菜。"
    if remaining is not None and light != "red":
        base += f"（剩餘約 {remaining} kcal）"
    return base
