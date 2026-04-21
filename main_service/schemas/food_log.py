from datetime import datetime
from pydantic import BaseModel


class FoodLogItem(BaseModel):
    id: int
    logged_at: datetime
    meal_type: str | None = None
    image_url: str | None = None
    food_items: list[dict] | None = None
    total_calories: float | None = None
    total_protein: float | None = None
    total_carbs: float | None = None
    total_fat: float | None = None
    ai_suggestion: str | None = None


class FoodLogCreateRequest(BaseModel):
    meal_type: str
    image_url: str | None = None
    food_items: list[dict] | None = None
    total_calories: float | None = None
    total_protein: float | None = None
    total_carbs: float | None = None
    total_fat: float | None = None
    ai_suggestion: str | None = None


class MacroPct(BaseModel):
    """三大營養素比例（百分比，總和 ≈ 100）。"""
    carbs: float
    protein: float
    fat: float


class FoodLogSummary(BaseModel):
    """病患 /me/summary 用：聚合今日餐點、目標熱量、30 天序列一次回。
    前端 Direction B Home + Diet + Trends tab 共用同一包資料。"""
    target_kcal: int | None = None      # patient.daily_kcal_target（目前 schema 沒有 → 回 None，前端 placeholder）
    today_kcal: float
    today_meals: list[FoodLogItem]
    dates: list[str]                    # range days，時間升冪
    kcal_series: list[float | None]     # dates 等長
    macros_series: list[MacroPct | None]
    macros_avg: MacroPct | None = None  # 整區間平均（macro % avg），null = 沒資料
