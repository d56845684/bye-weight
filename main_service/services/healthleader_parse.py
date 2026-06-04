"""解析 Healthleader 報告 SVG，抽出檢驗數據。

移植自 n8n flow node 8（Parse Lab Results (SVG)）。報告是一張 SVG，每個檢驗
項目是同一條水平線（相同 y）上的數個 <text>：
  - x < 400          → 項目名稱（e.g. "WBC Count (白血球)"）
  - 900 <= x <= 1200 → 數值（純數字）
  - 1250 <= x <= 1380→ 異常 flag（"H" / "L"）
依 y 把 <text> 分組成 row，再用 LAB_MAP 把項目名對映到欄位代碼。

輸出 dict：{ "WBC": {"value": 5.2, "flag": "H"}, "Hb": {"value": 14.1, "flag": None}, ... }
只含有抓到值的欄位；缺值的欄位不出現（下游當 None）。
"""
import re

# 項目名（含各種別名 / 報告用語）→ 欄位代碼。順序即比對優先序（前者先中）。
# 完整搬 n8n node 8 的 labMap。
LAB_MAP: dict[str, str] = {
    "WBC Count": "WBC", "RBC Count": "RBC",
    "Hemoglobin": "Hb", "Hematocrit": "Hct",
    "MCV": "MCV", "MCH": "MCH", "MCHC": "MCHC",
    "Platelet": "PLT",
    "Neutrophil Segment": "Neutrophil", "Lymphocyte": "Lymphocyte",
    "Monocyte": "Monocyte", "Eosinophil": "Eosinophil", "Basophil": "Basophil",
    "Triglyceride": "TG",
    "Total Cholesterol": "TC", "T-Cholesterol": "TC",
    "HDL-C": "HDL", "LDL-C": "LDL",
    "BUN": "BUN", "Creatinine": "Cr", "Uric Acid": "UA",
    "eGFR": "eGFR",
    "Fasting Sugar": "AC_Sugar", "AC Sugar": "AC_Sugar", "Sugar AC": "AC_Sugar", "GLU AC": "AC_Sugar",
    "PC Sugar": "PC_Sugar", "Sugar PC": "PC_Sugar", "GLU PC": "PC_Sugar",
    "HBA1c": "HbA1c", "HbA1c": "HbA1c", "Glycated Hemoglobin": "HbA1c",
    "S-GOT": "AST", "GOT": "AST", "AST": "AST",
    "S-GPT": "ALT", "GPT": "ALT", "ALT": "ALT",
    "r-GTP": "GGT", "r-GT": "GGT", "GGT": "GGT",
    "Alkaline Phosphatase": "ALP", "Alk-P": "ALP", "ALP": "ALP",
    "Total Bilirubin": "TBil", "T-Bilirubin": "TBil",
    "Direct Bilirubin": "DBil", "D-Bilirubin": "DBil",
    "Total Protein": "TP", "Albumin": "Alb", "Globulin": "Glob",
    "Sodium": "Na", "Potassium": "K",
    "Amylase": "Amylase", "TSH": "TSH", "Free T4": "FT4",
    "Calcium": "Ca", "Phosphorus": "P",
    "Iron": "Fe", "TIBC": "TIBC", "Ferritin": "Ferritin",
    "CRP": "CRP", "ESR": "ESR",
    "T3": "T3", "T4": "T4",
    "AFP": "AFP", "CEA": "CEA", "CA-199": "CA199", "PSA": "PSA",
    "Insulin": "Insulin", "C-Peptide": "CPeptide",
    "Vitamin D": "VitD", "25-OH Vitamin D": "VitD",
    "Homocysteine": "Hcy", "hs-CRP": "hsCRP",
}

_TEXT_RE = re.compile(
    r'<text[^>]*?x="([\d.]+)"[^>]*?y="([\d.]+)"[^>]*?>(.*?)</text>',
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]*>")
_VALUE_RE = re.compile(r"^[\d.]+$")
_PAREN_SUFFIX_RE = re.compile(r"\s*\(.*?\)\s*$")
_WS_RE = re.compile(r"\s+")


def _strip(s: str) -> str:
    """去掉內層標籤 + trim。"""
    return _TAG_RE.sub("", s or "").strip()


def _match_column(item_name: str) -> str | None:
    """項目名對映到欄位代碼。先用原名，再用去括號 / 收斂空白後的乾淨名（與 n8n 同序）。"""
    clean = _WS_RE.sub(" ", _PAREN_SUFFIX_RE.sub("", item_name)).strip()
    for key, col in LAB_MAP.items():
        if item_name == key or item_name.startswith(key):
            return col
    for key, col in LAB_MAP.items():
        if clean == key or clean.startswith(key):
            return col
    return None


def parse_lab_svg(svg: str) -> dict[str, dict]:
    """解析 SVG，回 {欄位: {"value": float, "flag": "H"|"L"|None}}。
    非 SVG / 空字串 → {}。"""
    if not svg or "<svg" not in svg:
        return {}

    # 依 y（四捨五入）把 <text> 分組成同一行
    rows: dict[int, list[tuple[float, str]]] = {}
    for m in _TEXT_RE.finditer(svg):
        x = float(m.group(1))
        y = round(float(m.group(2)))
        text = _strip(m.group(3))
        if not text:
            continue
        rows.setdefault(y, []).append((x, text))

    results: dict[str, dict] = {}
    for cells in rows.values():
        if len(cells) < 2:
            continue
        cells.sort(key=lambda c: c[0])

        item_name = ""
        value = ""
        flag = ""
        for x, text in cells:
            if x < 400:
                item_name = text
            if 900 <= x <= 1200 and _VALUE_RE.match(text):
                value = text
            if 1250 <= x <= 1380 and text in ("H", "L"):
                flag = text

        if not item_name or not value:
            continue
        col = _match_column(item_name)
        if not col:
            continue
        try:
            num = float(value)
        except ValueError:
            continue
        results[col] = {"value": num, "flag": flag or None}

    return results
