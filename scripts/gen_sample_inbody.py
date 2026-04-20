"""產生一張 fake 的 InBody 體組成報告 PNG，供本機測 LINE webhook → OCR → ingest 流程用。

用法（host 端包一層 docker，避免裝 Python / Pillow / CJK 字型到 host）：
    bash scripts/gen-sample-inbody.sh

輸出：scripts/sample-inbody.png
內容：Gemini prompt 期待的欄位全部都有明確標籤 —— 姓名 / 生日 / 體重 / BMI /
體脂率 / 肌肉量 / 內臟脂肪 / 基礎代謝率。欄位值可以直接改這個檔的 DEFAULTS
dict。要跟系統裡的 patient 對得上，記得後端 seed 同名 + 同生日的 patient。
"""
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DEFAULTS = {
    "name": "王小明",
    "birth_date": "1990-05-15",
    "gender": "男",
    "chart_no": "P000001",
    "height_cm": 172,
    "weight": 68.5,
    "bmi": 23.1,
    "body_fat_pct": 22.5,
    "muscle_mass": 48.2,
    "visceral_fat": 8,
    "metabolic_rate": 1580,
    "measured_at": date.today().isoformat(),
}

CJK_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]


def _load_font(size: int, bold: bool = False):
    """試著找一個能畫 CJK 的字型；都找不到就退回 default（方塊字也好過 crash）。"""
    order = CJK_FONT_CANDIDATES if not bold else [
        p for p in CJK_FONT_CANDIDATES if "Bold" in p
    ] + CJK_FONT_CANDIDATES
    for path in order:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_row(d: ImageDraw.ImageDraw, y: int, label: str, value: str, font_label, font_value, *, width: int):
    d.text((40, y), label, fill="#333333", font=font_label)
    # 右對齊值
    bbox = d.textbbox((0, 0), value, font=font_value)
    w = bbox[2] - bbox[0]
    d.text((width - 40 - w, y), value, fill="#005EB8", font=font_value)


def generate(out_path: Path, **fields):
    f = {**DEFAULTS, **fields}
    W, H = 800, 1100
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)

    font_title = _load_font(40, bold=True)
    font_h2 = _load_font(28, bold=True)
    font_body = _load_font(24)
    font_small = _load_font(20)

    # ── Header bar ──
    d.rectangle([0, 0, W, 90], fill="#005EB8")
    d.text((30, 22), "InBody 體組成分析報告", fill="white", font=font_title)

    # ── Patient info ──
    y = 120
    d.text((40, y), "基本資料", fill="#005EB8", font=font_h2); y += 45
    for label, val in [
        ("病歷號", f["chart_no"]),
        ("姓名", f["name"]),
        ("生日", f["birth_date"]),
        ("性別", f["gender"]),
        ("身高", f"{f['height_cm']} cm"),
        ("測量日期", f["measured_at"]),
    ]:
        draw_row(d, y, label, str(val), font_body, font_body, width=W)
        y += 40

    y += 20
    d.line([30, y, W - 30, y], fill="#005EB8", width=2); y += 20

    # ── Body composition ──
    d.text((40, y), "體組成分析", fill="#005EB8", font=font_h2); y += 50
    rows = [
        ("體重", f"{f['weight']} kg"),
        ("BMI", f"{f['bmi']}"),
        ("體脂率", f"{f['body_fat_pct']} %"),
        ("肌肉量", f"{f['muscle_mass']} kg"),
        ("內臟脂肪等級", f"{f['visceral_fat']}"),
        ("基礎代謝率", f"{f['metabolic_rate']} kcal"),
    ]
    for label, val in rows:
        draw_row(d, y, label, val, font_body, font_body, width=W)
        y += 50

    y += 40
    d.line([30, y, W - 30, y], fill="#CCCCCC", width=1); y += 20

    # ── Footer disclaimer ──
    d.text(
        (40, y),
        "此報告僅供系統開發測試使用，非真實測量結果。",
        fill="#888888",
        font=font_small,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG")
    return out_path


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default=DEFAULTS["name"])
    ap.add_argument("--birth-date", default=DEFAULTS["birth_date"])
    ap.add_argument("--chart-no", default=DEFAULTS["chart_no"])
    ap.add_argument("--weight", type=float, default=DEFAULTS["weight"])
    ap.add_argument("--bmi", type=float, default=DEFAULTS["bmi"])
    ap.add_argument("--body-fat", type=float, default=DEFAULTS["body_fat_pct"])
    ap.add_argument("--muscle", type=float, default=DEFAULTS["muscle_mass"])
    ap.add_argument("--visceral-fat", type=int, default=DEFAULTS["visceral_fat"])
    ap.add_argument("--metabolic-rate", type=int, default=DEFAULTS["metabolic_rate"])
    ap.add_argument("--output", default="sample-inbody.png")
    args = ap.parse_args()

    out = generate(
        Path(args.output),
        name=args.name,
        birth_date=args.birth_date,
        chart_no=args.chart_no,
        weight=args.weight,
        bmi=args.bmi,
        body_fat_pct=args.body_fat,
        muscle_mass=args.muscle,
        visceral_fat=args.visceral_fat,
        metabolic_rate=args.metabolic_rate,
    )
    print(f"✓ generated {out.resolve()}")
