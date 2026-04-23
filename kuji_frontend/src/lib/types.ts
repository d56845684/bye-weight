// kuji_backend 的 response 型別。跟 schemas/common.py 對齊。

export type MeetingStatus = "recording" | "processing" | "done";
export type MeetingSource = "record" | "upload" | "zoom" | "teams" | "meet";
export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "high" | "med" | "low";
export type TaskTag = "Notion" | "Slack" | "Calendar" | "Email" | "Teams" | "GitHub" | string;

export type TranscriptSegment = {
  id: number;
  speaker_id: string;
  speaker_name: string | null;
  speaker_user_id: number | null;
  speaker_is_external: boolean;
  speaker_external_org: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  highlight: string | null;
};

export type MeetingSpeaker = {
  id: number;
  speaker_id: string;             // S1 / S2 ...
  display_name: string;
  auth_user_id: number | null;
  is_external: boolean;
  external_org: string | null;
  match_source: "alias_match" | "manual_override" | "unknown" | string;
  match_confidence: number | null;
};

export type TaskClip = {
  id: number;
  role: "primary" | "related";
  rank: number;
  ai_confidence: number | null;
  note: string | null;
  segment_id: number;
  speaker_name: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  meeting_id: number | null;
  audio_url: string | null;
};

export type Task = {
  id: number;
  meeting_id: number | null;
  title: string;
  status: TaskStatus;
  owner_user_id: number | null;
  owner_name: string | null;
  due_at: string | null;
  due_label: string | null;
  tag: string | null;
  priority: TaskPriority;
  source_quote: string | null;
  ai_confidence: number | null;
  source_segment_id: number | null;
  source_segment_start_ms: number | null;
  clips: TaskClip[];
};

export type MeetingListItem = {
  id: number;
  title: string;
  status: MeetingStatus;
  source: MeetingSource;
  scheduled_at: string | null;
  duration_sec: number | null;
  speaker_count: number;
  task_count: number;
  audio_url: string | null;
};

export type MeetingDetail = MeetingListItem & {
  started_at: string | null;
  ended_at: string | null;
  summary: string | null;
  speakers: MeetingSpeaker[];
  transcript: TranscriptSegment[];
  tasks: Task[];
};

export type Integration = {
  id: number;
  kind: string;
  connected: boolean;
  workspace_label: string | null;
  connected_at: string | null;
  config: Record<string, unknown>;
};

export type ProviderFieldOption = {
  value: string;
  label_zh?: string | null;
  label_en?: string | null;
};

export type ProviderField = {
  key: string;
  label_zh?: string | null;
  label_en?: string | null;
  type: "text" | "password" | "select" | "textarea" | "checkbox" | "url" | "info";
  required?: boolean;
  placeholder?: string | null;
  hint_zh?: string | null;
  hint_en?: string | null;
  options?: ProviderFieldOption[] | null;
  dynamic_options_endpoint?: string | null;
};

export type IntegrationProvider = {
  kind: string;
  display_name: string;
  category: "source" | "destination";
  description_zh?: string | null;
  description_en?: string | null;
  oauth_url?: string | null;
  fields: ProviderField[];
};

export type DynamicOption = { value: string; label: string; hint?: string | null };

export type TeamMember = {
  id: number;
  auth_user_id: number;
  display_name: string;
  email: string | null;
  role_label: string;
  aliases: string[];
};

export type Me = {
  user_id: number;
  role: string;
  tenant_id: number;
  member: {
    display_name: string | null;
    email: string | null;
    role_label: string | null;
    aliases: string[];
  };
  stats: { meetings: number; tasks: number; routed_pct: number };
};
