"""init schema

Revision ID: 0001
Revises:
Create Date: 2026-04-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # employees
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("line_uuid", sa.String(64), nullable=False),
        sa.Column("name", sa.String(20), nullable=True),
        sa.Column("clinic_id", sa.String(20), nullable=True),
        sa.Column("role", sa.String(20), server_default="staff", nullable=True),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("line_uuid"),
    )

    # patients
    op.create_table(
        "patients",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("his_id", sa.String(20), nullable=True),
        sa.Column("name", sa.String(20), nullable=False),
        sa.Column("sex", sa.String(1), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=False),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # line_bindings
    op.create_table(
        "line_bindings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=True),
        sa.Column("line_uuid", sa.String(64), nullable=False),
        sa.Column("clinic_id", sa.String(20), nullable=True),
        sa.Column("bound_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("line_uuid"),
    )

    # visits
    op.create_table(
        "visits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=True),
        sa.Column("visit_date", sa.Date(), nullable=False),
        sa.Column("doctor_id", sa.String(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("next_visit_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # medications
    op.create_table(
        "medications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("visit_id", sa.Integer(), nullable=True),
        sa.Column("drug_name", sa.String(100), nullable=True),
        sa.Column("frequency", sa.String(20), nullable=True),
        sa.Column("days", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # inbody_records
    op.create_table(
        "inbody_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("measured_at", sa.DateTime(), nullable=False),
        sa.Column("weight", sa.Numeric(5, 2), nullable=True),
        sa.Column("bmi", sa.Numeric(4, 2), nullable=True),
        sa.Column("body_fat_pct", sa.Numeric(4, 2), nullable=True),
        sa.Column("muscle_mass", sa.Numeric(5, 2), nullable=True),
        sa.Column("visceral_fat", sa.Integer(), nullable=True),
        sa.Column("metabolic_rate", sa.Numeric(6, 0), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("raw_json", postgresql.JSONB(), nullable=True),
        sa.Column("match_status", sa.String(20), server_default="matched", nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # inbody_pending
    op.create_table(
        "inbody_pending",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("ocr_name", sa.String(20), nullable=True),
        sa.Column("ocr_birth_date", sa.Date(), nullable=True),
        sa.Column("ocr_data", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["uploaded_by"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # food_logs
    op.create_table(
        "food_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=True),
        sa.Column("logged_at", sa.DateTime(), nullable=False),
        sa.Column("meal_type", sa.String(10), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("food_items", postgresql.JSONB(), nullable=True),
        sa.Column("total_calories", sa.Numeric(6, 1), nullable=True),
        sa.Column("total_protein", sa.Numeric(5, 1), nullable=True),
        sa.Column("total_carbs", sa.Numeric(5, 1), nullable=True),
        sa.Column("total_fat", sa.Numeric(5, 1), nullable=True),
        sa.Column("ai_suggestion", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # notification_rules
    op.create_table(
        "notification_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("days_before", sa.Integer(), nullable=True),
        sa.Column("interval_days", sa.Integer(), nullable=True),
        sa.Column("send_time", sa.Time(), server_default=sa.text("'09:00'"), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # notification_logs
    op.create_table(
        "notification_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(20), nullable=True),
        sa.Column("format", sa.String(10), nullable=True),
        sa.Column("message_content", sa.Text(), nullable=True),
        sa.Column("status", sa.String(10), server_default="pending", nullable=True),
        sa.Column("scheduled_at", sa.DateTime(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("line_uuid", sa.String(64), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # indexes
    op.create_index("idx_line_bindings_uuid", "line_bindings", ["line_uuid"])
    op.create_index("idx_employees_uuid", "employees", ["line_uuid"])
    op.create_index("idx_inbody_patient_time", "inbody_records", ["patient_id", sa.text("measured_at DESC")])
    op.create_index("idx_food_patient_date", "food_logs", ["patient_id", sa.text("logged_at DESC")])
    op.create_index(
        "idx_visits_next_visit", "visits", ["next_visit_date"],
        postgresql_where=sa.text("next_visit_date IS NOT NULL"),
    )
    op.create_index(
        "idx_notif_rules_active", "notification_rules", ["patient_id"],
        postgresql_where=sa.text("active = TRUE"),
    )
    op.create_index(
        "idx_notif_logs_status", "notification_logs", ["status", "scheduled_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_table("notification_logs")
    op.drop_table("notification_rules")
    op.drop_table("food_logs")
    op.drop_table("inbody_pending")
    op.drop_table("inbody_records")
    op.drop_table("medications")
    op.drop_table("visits")
    op.drop_table("line_bindings")
    op.drop_table("patients")
    op.drop_table("employees")
