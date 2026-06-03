"""LLM provider 層 unit tests：JSON 解析容錯 + provider 工廠。"""
import pytest

from services.llm.base import extract_json


def test_extract_plain_json():
    assert extract_json('{"a": 1}') == {"a": 1}


def test_extract_fenced_multiline():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_extract_fenced_single_line():
    # 早期 split("\n") 實作在這種「單行 fence」會 IndexError；現在要能解析。
    assert extract_json('```{"a": 1}```') == {"a": 1}


def test_extract_json_with_surrounding_text():
    assert extract_json('好的，這是結果：\n{"a": 1}\n以上。') == {"a": 1}


def test_extract_none_and_empty():
    assert extract_json(None) is None
    assert extract_json("") is None
    assert extract_json("沒有任何大括號") is None


def test_extract_malformed_json_returns_none():
    assert extract_json('{"a": ') is None


def test_extract_non_object_returns_none():
    # 只接受 JSON object；陣列 / 純量回 None
    assert extract_json("[1, 2, 3]") is None


def test_get_llm_unknown_provider_raises(monkeypatch):
    import services.llm as llm
    llm.get_llm.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "nonsense")
    with pytest.raises(ValueError, match="unknown LLM_PROVIDER"):
        llm.get_llm()
    llm.get_llm.cache_clear()


def test_gemini_provider_disabled_without_key():
    from services.llm.gemini import GeminiProvider
    p = GeminiProvider(api_key="")
    assert p.available is False
