"""services/blood_test_sync.sync_blood_tests 的 mock-based 測試。

不打 Healthleader、不碰真 DB：HealthleaderClient 換成 FakeHL，db 換成 FakeDB。
驗：insert 筆數、去重 skip、bad chart_no 跳過、login 失敗中止、DetectDate 解析。
"""
from unittest.mock import AsyncMock

import pytest

import services.blood_test_sync as bts
from services.healthleader import HealthleaderError


# ── fakes ──────────────────────────────────────────────
class _Patient:
    def __init__(self, pid, chart_no):
        self.id = pid
        self.chart_no = chart_no
        self.tenant_id = 1
        self.deleted_at = None


class _Scalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _Result:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _Scalars(self._items)


class FakeDB:
    """execute() 依呼叫順序回 queued results；add 收集；commit noop。"""

    def __init__(self, results):
        self._results = list(results)
        self.added = []
        self.committed = False

    async def execute(self, stmt):
        return _Result(self._results.pop(0))

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True


class FakeHL:
    def __init__(self, reports_by_mrno, login_error=False):
        self.reports_by_mrno = reports_by_mrno
        self.login_error = login_error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def login(self):
        if self.login_error:
            raise HealthleaderError("bad creds")

    async def list_reports(self, mrno):
        return self.reports_by_mrno.get(mrno, [])

    async def report_svg_url(self, report_id):
        return f"http://svg/{report_id}"

    async def fetch_svg(self, url):
        return "<svg>fake</svg>"


def _patch(monkeypatch, fake_hl):
    monkeypatch.setattr(bts, "HealthleaderClient", lambda *a, **k: fake_hl)
    # 隔離 SVG 解析，sync 測試只關心流程
    monkeypatch.setattr(bts, "parse_lab_svg", lambda svg: {"WBC": {"value": 5.2, "flag": None}})


def _report(rid, date="2024-01-02 09:30:00", mrno="100"):
    return {"ID": rid, "DetectDate": date, "MRNo": mrno,
            "DetectNo": f"D{rid}", "CustomerName": "金鶯診所"}


@pytest.mark.asyncio
async def test_adds_new_reports(monkeypatch):
    fake_hl = FakeHL({"100": [_report("r1"), _report("r2")]})
    _patch(monkeypatch, fake_hl)
    db = FakeDB(results=[[_Patient(1, "TY100")], []])  # patients, existing ids

    out = await bts.sync_blood_tests(db, tenant_id=1, user_id=9, throttle_sec=0)

    assert out == {"patients": 1, "added": 2, "skipped": 0, "errors": 0}
    assert len(db.added) == 2
    assert db.committed
    assert db.added[0].patient_id == 1
    assert db.added[0].hl_report_id == "r1"
    assert db.added[0].lab_values == {"WBC": {"value": 5.2, "flag": None}}


@pytest.mark.asyncio
async def test_dedups_existing(monkeypatch):
    fake_hl = FakeHL({"100": [_report("r1"), _report("r2")]})
    _patch(monkeypatch, fake_hl)
    db = FakeDB(results=[[_Patient(1, "TY100")], ["r1"]])  # r1 already stored

    out = await bts.sync_blood_tests(db, tenant_id=1, user_id=9, throttle_sec=0)

    assert out["added"] == 1
    assert out["skipped"] == 1
    assert [r.hl_report_id for r in db.added] == ["r2"]


@pytest.mark.asyncio
async def test_bad_chart_no_skipped(monkeypatch):
    fake_hl = FakeHL({})
    _patch(monkeypatch, fake_hl)
    # chart_no 不符 字母+數字 → 不算 patient、不查報告
    db = FakeDB(results=[[_Patient(1, "no-digits")], []])

    out = await bts.sync_blood_tests(db, tenant_id=1, user_id=9, throttle_sec=0)

    assert out["patients"] == 0
    assert out["added"] == 0


@pytest.mark.asyncio
async def test_login_failure_aborts(monkeypatch):
    fake_hl = FakeHL({"100": [_report("r1")]}, login_error=True)
    _patch(monkeypatch, fake_hl)
    db = FakeDB(results=[[_Patient(1, "TY100")], []])

    out = await bts.sync_blood_tests(db, tenant_id=1, user_id=9, throttle_sec=0)

    assert out["errors"] == 1
    assert out["added"] == 0
    assert db.added == []


@pytest.mark.asyncio
async def test_strips_html_from_report_fields(monkeypatch):
    # HL 實際回傳 DetectDate / 欄位包 HTML（node 6 的 strip 對應），sync 要去標籤後才能用
    fake_hl = FakeHL({"41782": [{
        "ID": "r1",
        "DetectDate": '<div class="row justify-content-center">2026-03-30</div>',
        "MRNo": "<span>41782</span>",
        "DetectNo": "D1",
        "CustomerName": "<b>金鶯診所</b>",
    }]})
    _patch(monkeypatch, fake_hl)
    db = FakeDB(results=[[_Patient(1, "B41782")], []])

    out = await bts.sync_blood_tests(db, tenant_id=1, user_id=9, throttle_sec=0)

    assert out["added"] == 1
    rec = db.added[0]
    assert rec.test_date.year == 2026 and rec.test_date.month == 3 and rec.test_date.day == 30
    assert rec.hl_mrno == "41782"        # <span> 去掉
    assert rec.clinic_name == "金鶯診所"  # <b> 去掉


@pytest.mark.asyncio
async def test_unparseable_date_counts_error(monkeypatch):
    fake_hl = FakeHL({"100": [_report("r1", date="不是日期")]})
    _patch(monkeypatch, fake_hl)
    db = FakeDB(results=[[_Patient(1, "TY100")], []])

    out = await bts.sync_blood_tests(db, tenant_id=1, user_id=9, throttle_sec=0)

    assert out["added"] == 0
    assert out["errors"] == 1
