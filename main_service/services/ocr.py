import json
import os

import google.generativeai as genai

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.5-flash")


async def ocr_inbody(image_bytes: bytes) -> dict:
    """使用 Gemini 2.5 Flash 辨識 InBody 體組成報告。

    Schema 覆蓋 Direction B Body tab 需要的所有欄位；未印在報告上的欄位回傳 null
    （Gemini 看不到就 null，不強迫猜）。
    分部位（muscle_segmental / fat_segmental）會出現在詳細報告中（附身體示意圖），
    簡化版可能沒有，此時回空 object 或 null。
    """
    response = model.generate_content(
        [
            "請辨識這張 InBody 體組成報告，回傳 JSON 格式（沒看到的欄位填 null）：",
            """{
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
}""",
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
