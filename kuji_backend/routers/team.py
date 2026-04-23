from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models import TeamMember
from schemas.common import TeamMemberOut

router = APIRouter(prefix="/team", tags=["team"])


@router.get("/members", response_model=list[TeamMemberOut])
async def list_team_members(
    _user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(TeamMember).where(TeamMember.deleted_at.is_(None)).order_by(TeamMember.id.asc())
    )).scalars().all()
    return [TeamMemberOut.model_validate(r) for r in rows]
