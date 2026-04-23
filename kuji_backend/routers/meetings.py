from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models import Meeting, TranscriptSegment, Task, MeetingSpeaker, TeamMember
from schemas.common import (
    MeetingCreateRequest,
    MeetingDetailOut,
    MeetingListItem,
    MeetingPatchRequest,
    MeetingSpeakerOut,
    MeetingSpeakerPatchRequest,
    TaskOut,
    TranscriptSegmentOut,
)

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingListItem])
async def list_meetings(
    status: str | None = Query(None),
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出當前 tenant 的 meetings（by scheduled_at DESC），附 task count。RLS 會自動擋其他 tenant。"""
    stmt = (
        select(Meeting, func.count(Task.id).label("task_count"))
        .outerjoin(Task, (Task.meeting_id == Meeting.id) & (Task.deleted_at.is_(None)))
        .where(Meeting.deleted_at.is_(None))
        .group_by(Meeting.id)
        .order_by(Meeting.scheduled_at.desc().nulls_last(), Meeting.id.desc())
        .limit(200)
    )
    if status:
        stmt = stmt.where(Meeting.status == status)

    rows = (await db.execute(stmt)).all()
    return [
        MeetingListItem(
            id=m.id, title=m.title, status=m.status, source=m.source,
            scheduled_at=m.scheduled_at, duration_sec=m.duration_sec,
            speaker_count=m.speaker_count, task_count=task_count,
            audio_url=m.audio_url,
        )
        for m, task_count in rows
    ]


@router.post("", response_model=MeetingDetailOut, status_code=201)
async def create_meeting(
    payload: MeetingCreateRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """建立一場新 meeting。tenant_id 必須顯示指定（RLS WITH CHECK 會擋住 default 0）。"""
    m = Meeting(
        tenant_id=user["tenant_id"],
        title=payload.title,
        source=payload.source,
        status="recording",
        scheduled_at=datetime.utcnow(),
        started_at=datetime.utcnow(),
        speaker_count=0,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return MeetingDetailOut(
        id=m.id, title=m.title, status=m.status, source=m.source,
        scheduled_at=m.scheduled_at, duration_sec=m.duration_sec,
        speaker_count=m.speaker_count, task_count=0, audio_url=m.audio_url,
        started_at=m.started_at, ended_at=m.ended_at, summary=m.summary,
        speakers=[], transcript=[], tasks=[],
    )


@router.get("/{meeting_id}", response_model=MeetingDetailOut)
async def get_meeting(
    meeting_id: int,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """單一會議 detail：profile + speakers + transcript（join speaker）+ 相關 tasks 一次回。"""
    m = (await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.deleted_at.is_(None))
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "meeting not found")

    # speakers — 用 (meeting_id, speaker_id) 作 key 建 lookup，讓 transcript row 也能拿到
    speaker_rows = (await db.execute(
        select(MeetingSpeaker).where(
            MeetingSpeaker.meeting_id == meeting_id,
            MeetingSpeaker.deleted_at.is_(None),
        ).order_by(MeetingSpeaker.speaker_id.asc())
    )).scalars().all()
    speaker_map: dict[str, MeetingSpeaker] = {s.speaker_id: s for s in speaker_rows}

    # segments
    segments = (await db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.meeting_id == meeting_id)
        .order_by(TranscriptSegment.start_ms.asc())
    )).scalars().all()

    def _seg_to_out(s: TranscriptSegment) -> TranscriptSegmentOut:
        sp = speaker_map.get(s.speaker_id)
        return TranscriptSegmentOut(
            id=s.id,
            speaker_id=s.speaker_id,
            # 優先用 meeting_speakers 的 canonical name（user 手動改過會走這邊）
            speaker_name=(sp.display_name if sp else s.speaker_name),
            speaker_user_id=(sp.auth_user_id if sp else None),
            speaker_is_external=(sp.is_external if sp else True),
            speaker_external_org=(sp.external_org if sp else None),
            start_ms=s.start_ms, end_ms=s.end_ms,
            text=s.text, highlight=s.highlight,
        )

    # tasks
    task_rows = (await db.execute(
        select(Task, TranscriptSegment.start_ms)
        .outerjoin(TranscriptSegment, TranscriptSegment.id == Task.source_segment_id)
        .where(Task.meeting_id == meeting_id, Task.deleted_at.is_(None))
        .order_by(Task.id.asc())
    )).all()

    def _task_with_ms(t: Task, ms: int | None) -> TaskOut:
        d = TaskOut.model_validate(t).model_dump()
        d["source_segment_start_ms"] = ms
        return TaskOut.model_validate(d)

    return MeetingDetailOut(
        id=m.id, title=m.title, status=m.status, source=m.source,
        scheduled_at=m.scheduled_at, duration_sec=m.duration_sec,
        speaker_count=m.speaker_count, task_count=len(task_rows),
        audio_url=m.audio_url,
        started_at=m.started_at, ended_at=m.ended_at, summary=m.summary,
        speakers=[
            MeetingSpeakerOut(
                id=sp.id, speaker_id=sp.speaker_id, display_name=sp.display_name,
                auth_user_id=sp.auth_user_id, is_external=sp.is_external,
                external_org=sp.external_org, match_source=sp.match_source,
                match_confidence=float(sp.match_confidence) if sp.match_confidence is not None else None,
            )
            for sp in speaker_rows
        ],
        transcript=[_seg_to_out(s) for s in segments],
        tasks=[_task_with_ms(t, ms) for t, ms in task_rows],
    )


@router.patch("/{meeting_id}", response_model=MeetingDetailOut)
async def patch_meeting(
    meeting_id: int,
    payload: MeetingPatchRequest,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.deleted_at.is_(None))
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "meeting not found")
    if payload.title is not None:
        m.title = payload.title
    if payload.status is not None:
        m.status = payload.status
        if payload.status == "done" and m.ended_at is None:
            m.ended_at = datetime.utcnow()
    await db.commit()
    return await get_meeting(meeting_id, _user, db)  # type: ignore[arg-type]


# ═════════════════════════════════════════════════════════════════
# Manual speaker reassignment
# ═════════════════════════════════════════════════════════════════
@router.patch("/{meeting_id}/speakers/{speaker_id}", response_model=MeetingSpeakerOut)
async def patch_meeting_speaker(
    meeting_id: int,
    speaker_id: str,
    payload: MeetingSpeakerPatchRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """手動重指派 S1/S2/... 對應到哪個 team member（或標為外部 / 改名）。

    三種操作（由 body 裡哪些欄位「有傳」決定，用 Pydantic model_fields_set）：
      1. body={"auth_user_id": 1002}         → 指派給 user 1002（驗證 team_members 內存在）
      2. body={"auth_user_id": null}         → 明確標為外部（清 user link）
      3. body={"display_name": "X", ...}     → 只改 display_name / external_org

    成功後 transcript segments 的顯示自動跟著變（meetings router 是 JOIN meeting_speakers
    讀的，不動 transcript_segments.speaker_name 這個 snapshot）。
    """
    # 找目標 speaker row（RLS 自動擋其他 tenant）
    row = (await db.execute(
        select(MeetingSpeaker).where(
            MeetingSpeaker.meeting_id == meeting_id,
            MeetingSpeaker.speaker_id == speaker_id,
            MeetingSpeaker.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, f"speaker '{speaker_id}' not found in meeting {meeting_id}")

    set_fields = payload.model_fields_set

    # Case 1 & 2：傳了 auth_user_id（含顯式 null）
    if "auth_user_id" in set_fields:
        new_uid = payload.auth_user_id
        if new_uid is not None:
            # 驗證 team member 存在且屬於當前 tenant
            tm = (await db.execute(
                select(TeamMember).where(
                    TeamMember.auth_user_id == new_uid,
                    TeamMember.deleted_at.is_(None),
                )
            )).scalar_one_or_none()
            if tm is None:
                raise HTTPException(400, f"user {new_uid} is not a team member of this tenant")
            row.auth_user_id = new_uid
            row.is_external = False
            row.external_org = None
            # display_name 默認取 team_members.display_name；caller 顯式傳了就 override
            if "display_name" not in set_fields:
                row.display_name = tm.display_name
        else:
            # 明確標為外部
            row.auth_user_id = None
            row.is_external = True
            # external_org 交由 caller 控制；沒傳就清掉避免殘留
            if "external_org" not in set_fields:
                row.external_org = None

        row.match_source = "manual_override"
        row.match_confidence = 1.0  # 人工確認 = 100%

    # Case 3 / override：caller 顯式傳了這些欄位就寫
    if "display_name" in set_fields and payload.display_name is not None:
        row.display_name = payload.display_name
    if "external_org" in set_fields:
        row.external_org = payload.external_org  # 可傳 null 清除

    await db.commit()
    await db.refresh(row)
    return MeetingSpeakerOut(
        id=row.id, speaker_id=row.speaker_id, display_name=row.display_name,
        auth_user_id=row.auth_user_id, is_external=row.is_external,
        external_org=row.external_org, match_source=row.match_source,
        match_confidence=float(row.match_confidence) if row.match_confidence is not None else None,
    )
