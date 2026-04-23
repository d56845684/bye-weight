from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models import Task, TaskClip, TranscriptSegment, Meeting
from schemas.common import TaskCreateRequest, TaskOut, TaskPatchRequest, TaskClipOut

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _task_to_out(t: Task, seg_start_ms: int | None = None, clips: list[TaskClipOut] | None = None) -> TaskOut:
    d = TaskOut.model_validate(t).model_dump()
    d["source_segment_start_ms"] = seg_start_ms
    d["clips"] = clips or []
    return TaskOut.model_validate(d)


async def _fetch_clips_for_tasks(db: AsyncSession, task_ids: list[int]) -> dict[int, list[TaskClipOut]]:
    """Batch 查 clips（join segment + meeting.audio_url）避免 N+1。"""
    if not task_ids:
        return {}
    rows = (await db.execute(
        select(TaskClip, TranscriptSegment, Meeting.audio_url)
        .join(TranscriptSegment, TranscriptSegment.id == TaskClip.segment_id)
        .join(Meeting, Meeting.id == TranscriptSegment.meeting_id)
        .where(
            TaskClip.task_id.in_(task_ids),
            TaskClip.deleted_at.is_(None),
        )
        .order_by(TaskClip.task_id.asc(), TaskClip.role.asc(), TaskClip.rank.asc())
    )).all()
    out: dict[int, list[TaskClipOut]] = {}
    for clip, seg, audio_url in rows:
        item = TaskClipOut(
            id=clip.id,
            role=clip.role,
            rank=clip.rank,
            ai_confidence=float(clip.ai_confidence) if clip.ai_confidence is not None else None,
            note=clip.note,
            segment_id=seg.id,
            speaker_name=seg.speaker_name,
            start_ms=seg.start_ms,
            end_ms=seg.end_ms,
            text=seg.text,
            meeting_id=seg.meeting_id,
            audio_url=audio_url,
        )
        out.setdefault(clip.task_id, []).append(item)
    return out


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    status: str | None = Query(None),
    owner: int | None = Query(None, alias="owner"),
    meeting: int | None = Query(None),
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出當前 tenant 的 tasks。一次 fetch 所有 clips 避免 N+1。"""
    stmt = (
        select(Task, TranscriptSegment.start_ms)
        .outerjoin(TranscriptSegment, TranscriptSegment.id == Task.source_segment_id)
        .where(Task.deleted_at.is_(None))
        .order_by(Task.id.desc())
        .limit(500)
    )
    if status:
        stmt = stmt.where(Task.status == status)
    if owner:
        stmt = stmt.where(Task.owner_user_id == owner)
    if meeting:
        stmt = stmt.where(Task.meeting_id == meeting)

    rows = (await db.execute(stmt)).all()
    clips_by_task = await _fetch_clips_for_tasks(db, [t.id for t, _ in rows])
    return [_task_to_out(t, ms, clips_by_task.get(t.id, [])) for t, ms in rows]


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    payload: TaskCreateRequest,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    t = Task(
        tenant_id=user["tenant_id"],
        title=payload.title,
        meeting_id=payload.meeting_id,
        owner_user_id=payload.owner_user_id,
        owner_name=payload.owner_name,
        due_label=payload.due_label,
        tag=payload.tag,
        priority=payload.priority,
        source_quote=payload.source_quote,
        status="todo",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _task_to_out(t)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: int,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(Task, TranscriptSegment.start_ms)
        .outerjoin(TranscriptSegment, TranscriptSegment.id == Task.source_segment_id)
        .where(Task.id == task_id, Task.deleted_at.is_(None))
    )).first()
    if row is None:
        raise HTTPException(404, "task not found")
    t, ms = row
    clips_by_task = await _fetch_clips_for_tasks(db, [t.id])
    return _task_to_out(t, ms, clips_by_task.get(t.id, []))


@router.patch("/{task_id}", response_model=TaskOut)
async def patch_task(
    task_id: int,
    payload: TaskPatchRequest,
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    t = (await db.execute(
        select(Task).where(Task.id == task_id, Task.deleted_at.is_(None))
    )).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "task not found")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(t, k, v)
    await db.commit()
    await db.refresh(t)

    ms = None
    if t.source_segment_id:
        ms = (await db.execute(
            select(TranscriptSegment.start_ms).where(TranscriptSegment.id == t.source_segment_id)
        )).scalar_one_or_none()
    clips_by_task = await _fetch_clips_for_tasks(db, [t.id])
    return _task_to_out(t, ms, clips_by_task.get(t.id, []))


@router.delete("/{task_id}")
async def delete_task(
    task_id: int,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    t = (await db.execute(
        select(Task).where(Task.id == task_id, Task.deleted_at.is_(None))
    )).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "task not found")
    t.deleted_at = datetime.utcnow()
    t.deleted_by = user["user_id"]
    await db.commit()
    return {"status": "deleted", "id": task_id}
