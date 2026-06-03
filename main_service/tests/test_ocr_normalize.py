"""ocr.py 的數值 / 品項正規化 unit tests（不打 LLM）。

這層是 food/inbody ingest 的安全網：LLM 常吐字串數值或字串陣列，
正規化沒做好就會在寫 Numeric 欄位 / 組 food_names 時炸。
"""
from services.ocr import _normalize_items, _to_num


def test_to_num_passthrough():
    assert _to_num(500) == 500.0
    assert _to_num(12.5) == 12.5


def test_to_num_none():
    assert _to_num(None) is None


def test_to_num_string_with_unit():
    assert _to_num("約500 kcal") == 500.0
    assert _to_num("1065.0") == 1065.0
    assert _to_num("-3.2") == -3.2


def test_to_num_garbage_string():
    assert _to_num("不知道") is None


def test_to_num_bool_is_none():
    # bool 是 int 的子類，但語意上不是數值 → None
    assert _to_num(True) is None


def test_normalize_items_dicts():
    out = _normalize_items([{"name": "麻辣燙", "portion": "一碗"}, {"name": "茶"}])
    assert out == [
        {"name": "麻辣燙", "portion": "一碗"},
        {"name": "茶", "portion": None},
    ]


def test_normalize_items_strings():
    # LLM 有時回字串陣列 → 當品名收進來，不該 AttributeError
    assert _normalize_items(["麻辣燙", "泡麵"]) == [
        {"name": "麻辣燙", "portion": None},
        {"name": "泡麵", "portion": None},
    ]


def test_normalize_items_drops_nameless_and_blank():
    assert _normalize_items([{"portion": "一碗"}, "", "   ", {"name": ""}]) == []


def test_normalize_items_non_list():
    assert _normalize_items(None) == []
    assert _normalize_items("麻辣燙") == []
