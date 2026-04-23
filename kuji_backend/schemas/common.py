"""共用的 response schema bits。"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


MeetingStatus = Literal["recording", "processing", "done"]
MeetingSource = Literal["record", "upload", "zoom", "teams", "meet"]
TaskStatus = Literal["todo", "doing", "done"]
TaskPriority = Literal["high", "med", "low"]
TaskTag = Literal["notion", "slack", "gcal", "email", "teams", "github"]
IntegrationKind = Literal["notion", "slack", "gcal", "teams", "zoom", "gmeet"]


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TranscriptSegmentOut(OrmModel):
    id: int
    speaker_id: str                            # ASR 原始 label（S1/S2…）
    speaker_name: Optional[str] = None         # 顯示用（優先取 meeting_speakers.display_name）
    # 解析後的 speaker 身份（從 meeting_speakers JOIN 來）：
    speaker_user_id: Optional[int] = None      # 對到 team_members.auth_user_id；NULL → 外部
    speaker_is_external: bool = False
    speaker_external_org: Optional[str] = None
    start_ms: int
    end_ms: int
    text: str
    highlight: Optional[str] = None


class MeetingSpeakerOut(OrmModel):
    """每場會議的 speaker 清單（UI 側邊欄可顯示「本場參與者」+ 切換 external/internal filter）。"""
    id: int
    speaker_id: str
    display_name: str
    auth_user_id: Optional[int] = None
    is_external: bool
    external_org: Optional[str] = None
    match_source: str
    match_confidence: Optional[float] = None


class MeetingSpeakerPatchRequest(BaseModel):
    """手動重指派 speaker。三種操作都透過 Pydantic v2 的 model_fields_set 分辨：

    1. 指派給 team member：  body={"auth_user_id": 1002}
       → auth_user_id=1002, is_external=false, external_org=null,
         display_name 取 team_members.display_name（若也傳 display_name 就用傳入值 override）
         match_source='manual_override', match_confidence=1.0

    2. 明確標為外部：         body={"auth_user_id": null}
       → auth_user_id=null, is_external=true, match_source='manual_override'
         display_name 維持不變（除非另外傳）

    3. 僅改顯示名稱 / org：   body={"display_name": "Dr. Smith", "external_org": "Acme"}
       → 不動 auth_user_id / is_external
    """
    auth_user_id: Optional[int] = None
    display_name: Optional[str] = None
    external_org: Optional[str] = None


class TaskClipOut(OrmModel):
    """任務的錄音片段：AI 可以為一個 task 挑 1 個主片段 + 0-2 個相關片段。"""
    id: int
    role: str                # primary / related
    rank: int
    ai_confidence: Optional[float] = None
    note: Optional[str] = None
    # 從 transcript_segments join 過來
    segment_id: int
    speaker_name: Optional[str] = None
    start_ms: int
    end_ms: int
    text: str
    # 從父 meeting 取得；片段播放的音源
    meeting_id: Optional[int] = None
    audio_url: Optional[str] = None


class TaskOut(OrmModel):
    id: int
    meeting_id: Optional[int] = None
    title: str
    status: TaskStatus
    owner_user_id: Optional[int] = None
    owner_name: Optional[str] = None
    due_at: Optional[datetime] = None
    due_label: Optional[str] = None
    tag: Optional[str] = None
    priority: TaskPriority
    source_quote: Optional[str] = None
    ai_confidence: Optional[float] = None
    # 主片段（quick nav 用）；等同 clips 中 role='primary' 那筆的 segment_id
    source_segment_id: Optional[int] = None
    source_segment_start_ms: Optional[int] = None
    # 完整片段列表（primary + 0-2 related）。list endpoints 不一定會填（N+1 成本）；
    # detail endpoint 一定有。
    clips: list[TaskClipOut] = []


class MeetingListItem(OrmModel):
    id: int
    title: str
    status: MeetingStatus
    source: MeetingSource
    scheduled_at: Optional[datetime] = None
    duration_sec: Optional[int] = None
    speaker_count: int
    task_count: int = 0
    audio_url: Optional[str] = None


class MeetingDetailOut(MeetingListItem):
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    summary: Optional[str] = None
    speakers: list[MeetingSpeakerOut] = []     # 本場 speaker 清單（team / external）
    transcript: list[TranscriptSegmentOut] = []
    tasks: list[TaskOut] = []


class MeetingCreateRequest(BaseModel):
    title: str
    source: MeetingSource = "upload"


class MeetingPatchRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[MeetingStatus] = None


class TaskCreateRequest(BaseModel):
    title: str
    meeting_id: Optional[int] = None
    owner_user_id: Optional[int] = None
    owner_name: Optional[str] = None
    due_label: Optional[str] = None
    # tag 不強制 enum（seed + UI 用 "Slack" / "Notion" / "Calendar" 等 title-case，
    # 如 integrations 的 kind 反而是 lowercase，跨層級不好對齊，放寬字串讓 routing rules 處理）
    tag: Optional[str] = None
    priority: TaskPriority = "med"
    source_quote: Optional[str] = None


class TaskPatchRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[TaskStatus] = None
    owner_user_id: Optional[int] = None
    owner_name: Optional[str] = None
    due_label: Optional[str] = None
    tag: Optional[str] = None
    priority: Optional[TaskPriority] = None


class IntegrationOut(OrmModel):
    id: int
    kind: str
    connected: bool
    workspace_label: Optional[str] = None
    connected_at: Optional[datetime] = None
    config: dict = {}
    # 不回傳 tokens；外部只看 connected 狀態 + config


class ProviderFieldOption(BaseModel):
    value: str
    label_zh: Optional[str] = None
    label_en: Optional[str] = None


class ProviderField(BaseModel):
    """欄位 spec：前端用來渲染 form（OAuth 完成後的偏好設定）。"""
    key: str
    label_zh: Optional[str] = None
    label_en: Optional[str] = None
    type: str                       # text / password / select / textarea / checkbox / url / info
    required: bool = False
    placeholder: Optional[str] = None
    hint_zh: Optional[str] = None
    hint_en: Optional[str] = None
    # 靜態選項
    options: Optional[list[ProviderFieldOption]] = None
    # 動態選項端點：前端 fetch 這個 URL 拿 options（同個 IntegrationProvider spec）
    dynamic_options_endpoint: Optional[str] = None


class IntegrationProviderOut(OrmModel):
    kind: str
    display_name: str
    category: str                   # source / destination
    description_zh: Optional[str] = None
    description_en: Optional[str] = None
    oauth_url: Optional[str] = None
    fields: list[ProviderField] = []


class IntegrationConfigPatchRequest(BaseModel):
    """PUT /integrations/{kind}：更新 config。不影響 OAuth connected 狀態。"""
    config: dict
    workspace_label: Optional[str] = None


class DynamicOption(BaseModel):
    value: str
    label: str
    hint: Optional[str] = None


class DynamicOptionsOut(BaseModel):
    """動態選項端點的 response。label 已是顯示字串（不再分 zh/en；要 i18n 就改 backend provider API）。"""
    options: list[DynamicOption] = []


class TeamMemberOut(OrmModel):
    id: int
    auth_user_id: int
    display_name: str
    email: Optional[str] = None
    role_label: str
    aliases: list[str] = []
