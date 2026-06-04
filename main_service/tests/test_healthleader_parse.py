"""services/healthleader_parse.parse_lab_svg 的 SVG 解析測試。

用自構的最小 SVG（同一 y = 同一行，x 決定欄位角色）驗：
  - 項目名 → 欄位代碼對映（含別名 / 去括號 / 內層 tag strip）
  - 數值轉 float、H/L flag
  - 缺值 / 非 SVG / x 超出範圍 → 不收錄
"""
from services.healthleader_parse import parse_lab_svg


def _svg(*rows: str) -> str:
    return '<svg xmlns="http://www.w3.org/2000/svg">' + "".join(rows) + "</svg>"


def test_parses_value_and_flag():
    svg = _svg(
        '<text x="100" y="200">WBC Count (白血球)</text>',
        '<text x="1000" y="200">5.2</text>',
        '<text x="1300" y="200">H</text>',
        '<text x="100" y="260">Hemoglobin</text>',
        '<text x="1000" y="260">14.1</text>',
        '<text x="100" y="320">Creatinine</text>',
        '<text x="1000" y="320">0.9</text>',
        '<text x="1300" y="320">L</text>',
    )
    out = parse_lab_svg(svg)
    assert out["WBC"] == {"value": 5.2, "flag": "H"}
    assert out["Hb"] == {"value": 14.1, "flag": None}
    assert out["Cr"] == {"value": 0.9, "flag": "L"}


def test_strips_inner_tags_and_aliases():
    # "Total <tspan>Protein</tspan>" → "Total Protein" → TP
    svg = _svg(
        '<text x="120" y="400">Total <tspan>Protein</tspan></text>',
        '<text x="1000" y="400">7.2</text>',
        # 別名 S-GOT → AST
        '<text x="120" y="460">S-GOT</text>',
        '<text x="1000" y="460">28</text>',
    )
    out = parse_lab_svg(svg)
    assert out["TP"] == {"value": 7.2, "flag": None}
    assert out["AST"] == {"value": 28.0, "flag": None}


def test_skips_rows_without_value():
    # 只有項目名、沒有落在 900-1200 的數值 → 不收
    svg = _svg(
        '<text x="100" y="200">Albumin</text>',
        '<text x="1500" y="200">4.5</text>',  # x 超出 value 範圍
    )
    assert parse_lab_svg(svg) == {}


def test_non_svg_returns_empty():
    assert parse_lab_svg("") == {}
    assert parse_lab_svg("not an svg at all") == {}


def test_unmapped_item_ignored():
    svg = _svg(
        '<text x="100" y="200">Some Unknown Marker</text>',
        '<text x="1000" y="200">3.3</text>',
    )
    assert parse_lab_svg(svg) == {}
