from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models import TeamMember, Meeting, Task

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
async def get_me(
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """當前登入者在 kuji 的 summary：display_name + aliases + tenant 維度的統計。"""
    member = (await db.execute(
        select(TeamMember).where(
            TeamMember.auth_user_id == user["user_id"],
            TeamMember.deleted_at.is_(None),
        )
    )).scalar_one_or_none()

    meeting_count = (await db.execute(
        select(func.count(Meeting.id)).where(Meeting.deleted_at.is_(None))
    )).scalar_one()

    task_count = (await db.execute(
        select(func.count(Task.id)).where(Task.deleted_at.is_(None))
    )).scalar_one()

    routed_count = (await db.execute(
        select(func.count(Task.id)).where(Task.deleted_at.is_(None), Task.tag.isnot(None))
    )).scalar_one()

    return {
        "user_id": user["user_id"],
        "role": user["role"],
        "tenant_id": user["tenant_id"],
        "member": {
            "display_name": member.display_name if member else None,
            "email": member.email if member else None,
            "role_label": member.role_label if member else None,
            "aliases": member.aliases if member else [],
        },
        "stats": {
            "meetings": meeting_count,
            "tasks": task_count,
            "routed_pct": int(routed_count / task_count * 100) if task_count else 0,
        },
    }
