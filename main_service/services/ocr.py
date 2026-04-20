import json
import os

import google.generativeai as genai

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.5-flash")


async def ocr_inbody(image_bytes: bytes) -> dict:
    """使用 Gemini 2.5 Flash 辨識 InBody 體組成報告"""
    response = model.generate_content(
        [
            "請辨識這張 InBody 體組成報告，回傳 JSON 格式：",
            '{ "name": "姓名", "birth_date": "YYYY-MM-DD", '
            '"chart_no": "病歷號（若無則 null）", '
            '"weight": 數字, "bmi": 數字, "body_fat_pct": 數字, '
            '"muscle_mass": 數字, "visceral_fat": 整數, "metabolic_rate": 整數 }',
            "只回傳 JSON，不要其他文字。",
            {"mime_type": "image/jpeg", "data": image_bytes},
        ]
    )
    text = response.text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(text)


async def recognize_food(image_bytes: bytes) -> dict:
    """使用 Gemini 2.5 Flash 辨識食物照片並估算營養成分"""
    response = model.generate_content(
        [
            "請辨識這張食物照片，回傳 JSON 格式：",
            '{ "food_items": [{"name": "食物名稱", "portion": "份量描述"}], '
            '"total_calories": 數字, "total_protein": 數字, '
            '"total_carbs": 數字, "total_fat": 數字, '
            '"ai_suggestion": "營養建議（繁體中文，50字以內）" }',
            "只回傳 JSON，不要其他文字。",
            {"mime_type": "image/jpeg", "data": image_bytes},
        ]
    )
    text = response.text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(text)
