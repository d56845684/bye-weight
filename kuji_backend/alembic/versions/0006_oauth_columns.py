"""OAuth 2.0 欄位 + states 中間表 + 更新 provider fields schema

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-23

根據 docs/kuji-integrations-oauth.md 的結論：

1. integrations 加 oauth_* 欄位（access_token / refresh_token / expires_at / scope）+
   external_workspace_id / external_user_id。
2. 新表 integration_oauth_states：存 OAuth 授權啟動時的 state / PKCE verifier（防 CSRF），
   10 分鐘過期由 cron 清除。
3. 更新 integration_providers.fields：移除 password 類 token 欄位（OAuth 後不再手動貼），
   改成 OAuth 完成後的偏好欄位（select/checkbox），select 型別支援 dynamic_options_endpoint
   讓前端動態跟後端拿選項（例如 Notion databases / Slack channels）。

Token 加密：初期用 plain text；上 prod 前換成 pgcrypto pgp_sym_encrypt（key 從
KUJI_ENCRYPTION_KEY env var 讀）。欄位用 TEXT 兩種寫法都相容。
"""
from typing import Sequence, Union
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ────────────────────────────────────────────────────────────────
# 新的 provider fields — OAuth 後的偏好設定。
# 支援 field type：text / select / checkbox / textarea / url / password（少數仍需）
# select 可指定 dynamic_options_endpoint 讓前端從 backend 取選項。
# ────────────────────────────────────────────────────────────────
NEW_FIELDS = {
    "notion": [
        {"key": "tasks_database_id",
         "label_zh": "任務資料庫", "label_en": "Tasks database",
         "type": "select", "required": True,
         "dynamic_options_endpoint": "/integrations/notion/resources/databases",
         "hint_zh": "OAuth 授權後會列出你可存取的所有 database",
         "hint_en": "OAuth will list all databases you shared with Kuji"},
        {"key": "default_status",
         "label_zh": "新任務預設狀態", "label_en": "Default task status",
         "type": "select", "required": False,
         "options": [
             {"value": "inbox",       "label_zh": "Inbox",  "label_en": "Inbox"},
             {"value": "todo",        "label_zh": "待辦",    "label_en": "To Do"},
             {"value": "in-progress", "label_zh": "進行中",  "label_en": "In Progress"},
         ]},
    ],
    "slack": [
        {"key": "default_channel",
         "label_zh": "預設推送頻道", "label_en": "Default channel",
         "type": "select", "required": True,
         "dynamic_options_endpoint": "/integrations/slack/resources/channels",
         "hint_zh": "Kuji bot 要先被加到這個頻道",
         "hint_en": "Kuji bot must be invited to this channel"},
        {"key": "post_summary",
         "label_zh": "會議結束自動推摘要", "label_en": "Auto-post meeting summary",
         "type": "checkbox"},
        {"key": "mention_owners",
         "label_zh": "任務 @mention 負責人", "label_en": "@mention task owners",
         "type": "checkbox"},
    ],
    "gcal": [
        {"key": "calendar_id",
         "label_zh": "同步到哪個行事曆", "label_en": "Sync to which calendar",
         "type": "select", "required": True,
         "dynamic_options_endpoint": "/integrations/gcal/resources/calendars"},
        {"key": "default_duration",
         "label_zh": "預設事件時長", "label_en": "Default event duration",
         "type": "select",
         "options": [
             {"value": "30",  "label_zh": "30 分鐘", "label_en": "30 min"},
             {"value": "60",  "label_zh": "1 小時",   "label_en": "1 hour"},
             {"value": "120", "label_zh": "2 小時",   "label_en": "2 hours"},
         ]},
        {"key": "remind_before",
         "label_zh": "事前提醒", "label_en": "Remind before",
         "type": "select",
         "options": [
             {"value": "0",    "label_zh": "不提醒",   "label_en": "None"},
             {"value": "15",   "label_zh": "15 分鐘",  "label_en": "15 min"},
             {"value": "60",   "label_zh": "1 小時",    "label_en": "1 hour"},
             {"value": "1440", "label_zh": "1 天",       "label_en": "1 day"},
         ]},
    ],
    "teams": [
        {"key": "auto_join_all",
         "label_zh": "自動加入所有會議錄音", "label_en": "Auto-join all meetings",
         "type": "checkbox"},
        {"key": "record_scope",
         "label_zh": "錄音範圍", "label_en": "Recording scope",
         "type": "select",
         "options": [
             {"value": "owned",      "label_zh": "僅我主持的會議", "label_en": "Meetings I host"},
             {"value": "mentioned",  "label_zh": "我被提及的會議", "label_en": "Meetings where I'm mentioned"},
             {"value": "all",        "label_zh": "所有我參加的會議","label_en": "All meetings I attend"},
         ]},
    ],
    "zoom": [
        {"key": "record_mode",
         "label_zh": "錄音模式", "label_en": "Record mode",
         "type": "select", "required": True,
         "options": [
             {"value": "host_only",  "label_zh": "僅我主持的會議",  "label_en": "Host only"},
             {"value": "all",        "label_zh": "所有我參加的會議","label_en": "All meetings"},
             {"value": "filtered",   "label_zh": "符合規則才錄",    "label_en": "Rules only"},
         ]},
        {"key": "auto_start",
         "label_zh": "會議開始自動錄", "label_en": "Auto-start recording",
         "type": "checkbox"},
    ],
    "gmeet": [
        {"key": "workspace_required",
         "label_zh": "需 Google Workspace Business Standard 以上 + admin 授權",
         "label_en": "Requires Google Workspace Business Standard + admin consent",
         "type": "info"},
        {"key": "calendar_id",
         "label_zh": "監聽哪個行事曆的 Meet 會議", "label_en": "Watch which calendar for Meet meetings",
         "type": "select", "required": True,
         "dynamic_options_endpoint": "/integrations/gmeet/resources/calendars"},
    ],
}


def upgrade() -> None:
    # ── 1. integrations 加 OAuth 欄位 ─────────────
    op.add_column("integrations", sa.Column("oauth_access_token",    sa.Text(), nullable=True))
    op.add_column("integrations", sa.Column("oauth_refresh_token",   sa.Text(), nullable=True))
    op.add_column("integrations", sa.Column("oauth_token_type",      sa.String(20), nullable=True))
    op.add_column("integrations", sa.Column("oauth_expires_at",      sa.DateTime(), nullable=True))
    op.add_column("integrations", sa.Column("oauth_scope",           sa.Text(), nullable=True))
    op.add_column("integrations", sa.Column("external_workspace_id", sa.String(200), nullable=True))
    op.add_column("integrations", sa.Column("external_user_id",      sa.String(200), nullable=True))

    # ── 2. integration_oauth_states（中間表）─────
    op.create_table(
        "integration_oauth_states",
        sa.Column("state",         sa.String(64), nullable=False),
        sa.Column("tenant_id",     sa.Integer(), nullable=False),
        sa.Column("user_id",       sa.Integer(), nullable=False),
        sa.Column("kind",          sa.String(20), nullable=False),
        sa.Column("pkce_verifier", sa.String(128), nullable=True),
        sa.Column("return_to",     sa.String(500), nullable=True),  # callback 後導回前端的 URL
        sa.Column("expires_at",    sa.DateTime(), nullable=False),
        sa.Column("created_at",    sa.DateTime(), server_default=sa.text("NOW()"), nullable=False),
        sa.PrimaryKeyConstraint("state"),
    )
    op.create_index("idx_oauth_states_expires", "integration_oauth_states", ["expires_at"])

    # states 不走 RLS（短期中間表，不分 tenant 讀 only by state primary key；tenant 檢查在 callback 層）
    # 授權 app_user 讀寫
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON integration_oauth_states TO app_user;")
    # 確保 integration_providers 有 grant（0005 以前版本若沒補）
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON integration_providers TO app_user;")

    # ── 3. 更新 integration_providers.fields ─────
    for kind, fields in NEW_FIELDS.items():
        fields_json = json.dumps(fields, ensure_ascii=False).replace("'", "''")
        op.execute(
            f"UPDATE integration_providers SET fields = '{fields_json}'::jsonb WHERE kind = '{kind}';"
        )


def downgrade() -> None:
    op.drop_index("idx_oauth_states_expires", "integration_oauth_states")
    op.drop_table("integration_oauth_states")
    for col in [
        "external_user_id", "external_workspace_id", "oauth_scope",
        "oauth_expires_at", "oauth_token_type", "oauth_refresh_token", "oauth_access_token",
    ]:
        op.drop_column("integrations", col)
