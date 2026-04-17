from fastapi import Header


async def current_user(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    x_clinic_id: str = Header(...),
    x_patient_id: str = Header(default=""),
):
    return {
        "user_id": int(x_user_id),
        "role": x_user_role,
        "clinic_id": x_clinic_id,
        "patient_id": int(x_patient_id) if x_patient_id else None,
    }
