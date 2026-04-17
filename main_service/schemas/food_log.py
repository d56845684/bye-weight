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
