import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import storage

from deps import current_user

router = APIRouter(prefix="/upload", tags=["upload"])

GCS_BUCKET = os.getenv("GCS_BUCKET_NAME", "")


@router.post("/presigned-url")
async def get_presigned_url(
    file_type: str,
    user: dict = Depends(current_user),
):
    """
    取得 GCS presigned URL（fix #3: 強制使用認證使用者的 patient_id）
    file_type: "inbody" | "food"
    """
    patient_id = user["patient_id"]
    role = user["role"]

    # staff/admin 上傳 InBody 時不需要 patient_id
    if file_type == "food" and not patient_id:
        raise HTTPException(403, "patient_id required for food uploads")

    if file_type == "inbody" and role not in ("staff", "nutritionist", "admin"):
        raise HTTPException(403, "only staff can upload InBody records")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if file_type == "inbody":
        # 員工上傳 InBody：用上傳者 user_id 而非 patient_id（配對後再分配）
        blob_path = f"inbody/pending/{user['user_id']}/{timestamp}.jpg"
    elif file_type == "food":
        blob_path = f"food/{patient_id}/{timestamp}.jpg"
    else:
        raise HTTPException(400, "invalid file_type, must be 'inbody' or 'food'")

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(blob_path)

    url = blob.generate_signed_url(
        version="v4",
        expiration=300,  # 5 分鐘
        method="PUT",
        content_type="image/jpeg",
    )

    return {"upload_url": url, "blob_path": blob_path}
