"""integration provider specs + per-integration config

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-23

新增 integration_providers 表：存每家外部 provider 的顯示名稱、欄位 schema、
分類（source / destination）、OAuth URL 等靜態參考資料（多租戶共用，不分 tenant）。

在 integrations 加 config JSONB：存使用者在該 provider 填的設定值
（例如 Notion token / Slack channel / GCal calendar_id）。

前端打開 provider 設定彈窗時：
  1. GET /integrations/providers 拿 schema
  2. GET /integrations 拿當前 config 值
  3. 渲染動態 form
  4. PUT /integrations/{kind} 存回
"""
from typing import Sequence, Union
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 6 家 provider 的欄位 schema。field types: text / password / select / textarea / checkbox。
# labels / hints / options 都中英對照，前端照 prefs.lang 選字。
PROVIDER_SEEDS = [
    {
        "kind": "notion", "display_name": "Notion", "category": "destination",
        "description_zh": "把任務與會議紀要寫進指定資料庫",
        "description_en": "Sync tasks and meeting notes to a database",
        "oauth_url": "https://api.notion.com/v1/oauth/authorize",
        "fields": [
            {"key": "integration_token", "label_zh": "Integration Token", "label_en": "Integration Token",
             "type": "password", "required": True,
             "placeholder": "secret_xxxxxxxxxxxx",
             "hint_zh": "從 notion.so/my-integrations 建立 internal integration 後複製",
             "hint_en": "Create an internal integration at notion.so/my-integrations and copy the secret"},
            {"key": "tasks_database_id", "label_zh": "任務資料庫 ID", "label_en": "Tasks database ID",
             "type": "text", "required": True,
             "placeholder": "3d7f... (32 字)",
             "hint_zh": "資料庫 URL 的最後那段 hash",
             "hint_en": "The 32-char hash at the end of the database URL"},
            {"key": "default_status", "label_zh": "建立任務時的預設狀態", "label_en": "Default status for new tasks",
             "type": "select", "required": False,
             "options": [
                 {"value": "inbox",       "label_zh": "Inbox",        "label_en": "Inbox"},
                 {"value": "todo",        "label_zh": "待辦",          "label_en": "To Do"},
                 {"value": "in-progress", "label_zh": "進行中",        "label_en": "In Progress"},
             ]},
        ],
    },
    {
        "kind": "slack", "display_name": "Slack", "category": "destination",
        "description_zh": "會議結束時推送摘要與行動事項",
        "description_en": "Post summaries and action items after meetings",
        "oauth_url": "https://slack.com/oauth/v2/authorize",
        "fields": [
            {"key": "bot_token", "label_zh": "Bot Token", "label_en": "Bot Token",
             "type": "password", "required": True,
             "placeholder": "xoxb-...",
             "hint_zh": "在 Slack app 的 OAuth & Permissions 頁複製 Bot User OAuth Token",
             "hint_en": "Copy the Bot User OAuth Token from your Slack app"},
            {"key": "default_channel", "label_zh": "預設推送頻道", "label_en": "Default channel",
             "type": "text", "required": True,
             "placeholder": "#product",
             "hint_zh": "bot 必須先被加到這個頻道",
             "hint_en": "The bot must be invited to this channel first"},
            {"key": "post_summary", "label_zh": "會議結束自動推摘要", "label_en": "Auto-post meeting summary",
             "type": "checkbox", "required": False},
            {"key": "mention_owners", "label_zh": "任務 @mention 負責人", "label_en": "Mention task owners",
             "type": "checkbox", "required": False},
        ],
    },
    {
        "kind": "gcal", "display_name": "Google Calendar", "category": "destination",
        "description_zh": "將期限同步為行事曆事件",
        "description_en": "Turn due dates into calendar events",
        "oauth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "fields": [
            {"key": "calendar_id", "label_zh": "行事曆 ID", "label_en": "Calendar ID",
             "type": "text", "required": True,
             "placeholder": "primary",
             "hint_zh": "primary = 主行事曆；或貼完整 calendar@group.calendar.google.com",
             "hint_en": "Use 'primary' or a full calendar@group.calendar.google.com address"},
            {"key": "default_duration", "label_zh": "預設事件時長", "label_en": "Default event duration",
             "type": "select", "required": False,
             "options": [
                 {"value": "30",  "label_zh": "30 分鐘", "label_en": "30 min"},
                 {"value": "60",  "label_zh": "1 小時",   "label_en": "1 hour"},
                 {"value": "120", "label_zh": "2 小時",   "label_en": "2 hours"},
             ]},
            {"key": "remind_before", "label_zh": "事前提醒", "label_en": "Remind before",
             "type": "select", "required": False,
             "options": [
                 {"value": "0",    "label_zh": "不提醒",   "label_en": "None"},
                 {"value": "15",   "label_zh": "15 分鐘",  "label_en": "15 min"},
                 {"value": "60",   "label_zh": "1 小時",    "label_en": "1 hour"},
                 {"value": "1440", "label_zh": "1 天",       "label_en": "1 day"},
             ]},
        ],
    },
    {
        "kind": "teams", "display_name": "Microsoft Teams", "category": "source",
        "description_zh": "從 Teams 會議自動錄音",
        "description_en": "Auto-record Teams meetings",
        "oauth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "fields": [
            {"key": "tenant_id", "label_zh": "Azure Tenant ID", "label_en": "Azure Tenant ID",
             "type": "text", "required": True,
             "placeholder": "00000000-0000-0000-0000-000000000000"},
            {"key": "client_id", "label_zh": "App Client ID", "label_en": "App Client ID",
             "type": "text", "required": True},
            {"key": "client_secret", "label_zh": "Client Secret", "label_en": "Client Secret",
             "type": "password", "required": True},
            {"key": "auto_join", "label_zh": "自動加入會議錄音", "label_en": "Auto-join meetings",
             "type": "checkbox", "required": False},
        ],
    },
    {
        "kind": "zoom", "display_name": "Zoom", "category": "source",
        "description_zh": "從 Zoom 會議自動錄音",
        "description_en": "Auto-record Zoom meetings",
        "oauth_url": "https://zoom.us/oauth/authorize",
        "fields": [
            {"key": "account_id", "label_zh": "Zoom Account ID", "label_en": "Zoom Account ID",
             "type": "text", "required": True},
            {"key": "client_id", "label_zh": "OAuth Client ID", "label_en": "OAuth Client ID",
             "type": "text", "required": True},
            {"key": "client_secret", "label_zh": "OAuth Client Secret", "label_en": "OAuth Client Secret",
             "type": "password", "required": True},
            {"key": "webhook_url", "label_zh": "Webhook URL（複製到 Zoom 設定）",
             "label_en": "Webhook URL (copy into Zoom)",
             "type": "url", "required": False,
             "placeholder": "https://kuji.app/kuji/api/v1/webhook/zoom"},
        ],
    },
    {
        "kind": "gmeet", "display_name": "Google Meet", "category": "source",
        "description_zh": "從 Google Meet 會議自動錄音",
        "description_en": "Auto-record Meet calls",
        "oauth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "fields": [
            {"key": "workspace_domain", "label_zh": "Workspace 網域", "label_en": "Workspace domain",
             "type": "text", "required": True,
             "placeholder": "acme.com"},
            {"key": "service_account_json", "label_zh": "Service Account JSON",
             "label_en": "Service Account JSON",
             "type": "textarea", "required": True,
             "hint_zh": "從 GCP Console 下載的 service account 金鑰 JSON",
             "hint_en": "Service account key JSON downloaded from GCP Console"},
        ],
    },
]


def upgrade() -> None:
    # 1. 新表 integration_providers
    op.create_table(
        "integration_providers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),         # source / destination
        sa.Column("description_zh", sa.Text(), nullable=True),
        sa.Column("description_en", sa.Text(), nullable=True),
        sa.Column("oauth_url", sa.String(500), nullable=True),
        sa.Column("fields", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", name="uq_integration_providers_kind"),
    )

    # 2. 在 integrations 加 config JSONB
    op.add_column("integrations", sa.Column("config", postgresql.JSONB(), nullable=False, server_default="{}"))

    # 2b. app_user 讀寫新表的 grant（0002 的 GRANT ALL 只對當時存在的表生效）
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON integration_providers TO app_user;")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE integration_providers_id_seq TO app_user;")

    # 3. Seed provider specs
    for i, p in enumerate(PROVIDER_SEEDS):
        fields_json = json.dumps(p["fields"], ensure_ascii=False).replace("'", "''")
        desc_zh = (p.get("description_zh") or "").replace("'", "''")
        desc_en = (p.get("description_en") or "").replace("'", "''")
        oauth  = p.get("oauth_url") or ""
        op.execute(
            f"""
            INSERT INTO integration_providers
                (kind, display_name, category, description_zh, description_en, oauth_url, fields, sort_order)
            VALUES
                ('{p["kind"]}', '{p["display_name"]}', '{p["category"]}',
                 '{desc_zh}', '{desc_en}',
                 {f"'{oauth}'" if oauth else "NULL"},
                 '{fields_json}'::jsonb, {i * 10});
            """
        )


def downgrade() -> None:
    op.drop_table("integration_providers")
    op.drop_column("integrations", "config")
