"""影像辨識：InBody 報告 + 食物照。走 services.llm provider，不直接綁 vendor。

LLM 回傳的數值欄位一律經 `_to_num` 正規化成 float | None（LLM 常吐 "約500"、
"500 kcal" 之類字串，直接塞 Numeric 欄位會炸）；食物品項經 `_normalize_items`
收斂成 list[dict]（LLM 有時回字串陣列）。下游（food_ingest / inbody_ingest）
因此能假設拿到的數值是乾淨的。

LLM 不可用 / 回應無法解析 → raise ValueError，讓呼叫端的 try/except 走
ocr_failed / pending 分支。
"""
import re

from services.llm import get_llm

_INBODY_PROMPT = """請辨識這張 InBody 體組成報告，回傳 JSON 格式（沒看到的欄位填 null）：
{
  "name": "姓名",
  "birth_date": "YYYY-MM-DD",
  "chart_no": "病歷號",
  "weight": 數字,
  "bmi": 數字,
  "body_fat_pct": 數字,
  "muscle_mass": 數字 (骨骼肌量 kg),
  "visceral_fat": 整數 (內臟脂肪等級),
  "metabolic_rate": 整數 (基礎代謝率 kcal),
  "body_age": 整數 (身體年齡 歲),
  "total_body_water": 數字 (體內水分 kg),
  "protein_mass": 數字 (蛋白質 kg),
  "mineral_mass": 數字 (無機鹽 kg),
  "muscle_segmental": { "la": 左手臂 kg, "ra": 右手臂 kg, "tr": 軀幹 kg, "ll": 左腿 kg, "rl": 右腿 kg },
  "fat_segmental":    { "la": 左手臂 kg, "ra": 右手臂 kg, "tr": 軀幹 kg, "ll": 左腿 kg, "rl": 右腿 kg }
}
只回傳 JSON，不要其他文字。"""

_FOOD_PROMPT = """請辨識這張食物照片，回傳 JSON 格式：
{ "food_items": [{"name": "食物名稱", "portion": "份量描述"}],
  "total_calories": 數字, "total_protein": 數字,
  "total_carbs": 數字, "total_fat": 數字,
  "ai_suggestion": "營養建議（繁體中文，50字以內）" }
只回傳 JSON，不要其他文字。"""

# InBody 報告上的純數值欄位（segmental 由 inbody_ingest._clean_seg 另外處理）
_INBODY_NUM_FIELDS = (
    "weight", "bmi", "body_fat_pct", "muscle_mass", "visceral_fat",
    "metabolic_rate", "body_age", "total_body_water", "protein_mass", "mineral_mass",
)
_FOOD_NUM_FIELDS = ("total_calories", "total_protein", "total_carbs", "total_fat")

_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _to_num(v) -> float | None:
    """把 LLM 吐的值轉成 float。None / 無數字 → None；字串裡夾單位（"約500 kcal"）
    抓第一個數字。"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = _NUM_RE.search(v)
        return float(m.group()) if m else None
    return None


def _normalize_items(items) -> list[dict]:
    """food_items 收斂成 [{"name": str, "portion": str|None}]。
    非 list → []；元素是 dict 取 name/portion；元素是字串當品名。"""
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for it in items:
        if isinstance(it, dict):
            name = it.get("name")
            if name:
                out.append({"name": str(name), "portion": it.get("portion")})
        elif isinstance(it, str) and it.strip():
            out.append({"name": it.strip(), "portion": None})
    return out


async def ocr_inbody(image_bytes: bytes) -> dict:
    """辨識 InBody 報告。回傳正規化後的 dict；無法辨識 → raise ValueError。"""
    data = await get_llm().complete_json(_INBODY_PROMPT, images=[image_bytes])
    if data is None:
        raise ValueError("inbody OCR returned no parseable result")
    for f in _INBODY_NUM_FIELDS:
        data[f] = _to_num(data.get(f))
    return data


async def recognize_food(image_bytes: bytes) -> dict:
    """辨識食物照片 + 估營養。回傳正規化後的 dict；無法辨識 → raise ValueError。"""
    data = await get_llm().complete_json(_FOOD_PROMPT, images=[image_bytes])
    if data is None:
        raise ValueError("food recognition returned no parseable result")
    return {
        "food_items": _normalize_items(data.get("food_items")),
        "total_calories": _to_num(data.get("total_calories")),
        "total_protein": _to_num(data.get("total_protein")),
        "total_carbs": _to_num(data.get("total_carbs")),
        "total_fat": _to_num(data.get("total_fat")),
        "ai_suggestion": data.get("ai_suggestion"),
    }
