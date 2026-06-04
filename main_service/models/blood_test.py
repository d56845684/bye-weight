from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.patient import Base
from models._mixin import AuditMixin


class BloodTestReport(AuditMixin, Base):
    """從 Healthleader 後台同步下來的抽血報告。

    一筆 = HL 的一份報告（report.ID）。37 項檢驗值整包存 JSONB（lab_values），
    避免每加一項就 ALTER；查詢 / 去重靠結構化關鍵欄（patient_id / tenant_id /
    test_date / hl_report_id）。lab_values 形如：
        {"WBC": {"value": 5.2, "flag": "H"}, "Hb": {"value": 14.1, "flag": null}, ...}
    flag 為 "H" / "L" / None。
    """
    __tablename__ = "blood_test_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    # HL report.ID：同 tenant 內去重主鍵（partial unique index 見 migration 0011）
    hl_report_id: Mapped[str] = mapped_column(String(64), nullable=False)
    hl_mrno: Mapped[str | None] = mapped_column(String(32))      # report.MRNo（HL病歷號）
    detect_no: Mapped[str | None] = mapped_column(String(64))    # report.DetectNo
    clinic_name: Mapped[str | None] = mapped_column(String(100))  # report.CustomerName（診所）
    test_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)  # report.DetectDate
    lab_values: Mapped[dict | None] = mapped_column(JSONB)
    svg_url: Mapped[str | None] = mapped_column(Text)            # 來源 SVG（debug / 重抓）
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
