import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import storage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps import current_user
from models.patient import Patient

router = APIRouter(prefix="/upload", tags=["upload"])

GCS_BUCKET = os.getenv("GCS_BUCKET_NAME", "")


@router.post("/presigned-url")
async def get_presigned_url(
    file_type: str,
    user: dict = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """取得 GCS presigned URL。
    file_type: "inbody" | "food"
    - food: 病患上傳自己的，blob path 用該 user 對應的 patient.id
    - inbody: 員工上傳，blob path 用 uploader 的 user_id（配對後再搬）
    """
    role = user["role"]
    tenant_id = user["tenant_id"]

    if file_type == "inbody":
        if role not in ("staff", "nutritionist", "admin"):
            raise HTTPException(403, "only staff can upload InBody records")
        blob_path = f"inbody/pending/t{tenant_id}/u{user['user_id']}/{datetime.now():%Y%m%d_%H%M%S}.jpg"
    elif file_type == "food":
        patient = (await db.execute(
            select(Patient).where(
                Patient.auth_user_id == user["user_id"],
                Patient.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if not patient:
            raise HTTPException(403, "no patient profile for current user")
        blob_path = f"food/t{tenant_id}/p{patient.id}/{datetime.now():%Y%m%d_%H%M%S}.jpg"
    else:
        raise HTTPException(400, "invalid file_type, must be 'inbody' or 'food'")

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(blob_path)
    url = blob.generate_signed_url(
        version="v4",
        expiration=300,
        method="PUT",
        content_type="image/jpeg",
    )
    return {"upload_url": url, "blob_path": blob_path}
