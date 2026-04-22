from datetime import datetime
from pydantic import BaseModel, Field


class FoodLogImageItem(BaseModel):
    """一筆飲食紀錄底下的一張圖。blob_path = GCS object 路徑，前端自己組 URL
    或另外打 signed-url endpoint 取 read-only URL。"""
    id: int
    blob_path: str
    position: int = 0
    caption: str | None = None


class FoodLogItem(BaseModel):
    id: int
    logged_at: datetime
    meal_type: str | None = None
    images: list[FoodLogImageItem] = Field(default_factory=list)
    food_items: list[dict] | None = None
    total_calories: float | None = None
    total_protein: float | None = None
    total_carbs: float | None = None
    total_fat: float | None = None
    ai_suggestion: str | None = None


class FoodLogCreateRequest(BaseModel):
    """病患端建立飲食紀錄。image_paths = 已透過 /upload/presigned-url 上傳好
    的 GCS blob path list，可空可多張；server 依 list 順序當 position。"""
    meal_type: str
    image_paths: list[str] = Field(default_factory=list)
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


class FoodLogAdminItem(BaseModel):
    """Admin 後台 tenant-wide 飲食列表用。帶病患姓名 + 病歷號避免前端 N+1；
    只回 image_count + primary_image_path，避免 list 頁面吃滿 payload。"""
    id: int
    patient_id: int
    patient_name: str | None = None
    chart_no: str | None = None
    logged_at: datetime
    meal_type: str | None = None
    image_count: int = 0
    primary_image_path: str | None = None
    total_calories: float | None = None
    total_protein: float | None = None
    total_carbs: float | None = None
    total_fat: float | None = None
    ai_suggestion: str | None = None


class FoodLogSummary(BaseModel):
    """病患 /me/summary 用：聚合今日餐點、當前目標、30 天序列一次回。
    前端 Direction B Home + Diet + Trends tab 共用同一包資料。

    target_* 來自 patient_goals 最新生效 row（歷史 append-only）；null 代表營養師
    尚未設定，前端可 fallback 到 UI 預設。"""
    target_kcal: int | None = None
    target_macros: MacroPct | None = None  # carbs/protein/fat % 目標，三個都 null 時整包 null
    today_kcal: float
    today_meals: list[FoodLogItem]
    dates: list[str]                    # range days，時間升冪
    kcal_series: list[float | None]     # dates 等長
    macros_series: list[MacroPct | None]
    macros_avg: MacroPct | None = None  # 整區間平均（macro % avg），null = 沒資料
