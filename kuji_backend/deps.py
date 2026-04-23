from fastapi import Header


async def current_user(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    x_tenant_id: str = Header(...),
):
    """Nginx auth_request 驗證通過後注入的 identity header。
    Kuji 不再自己驗 JWT；authorization 已經在 auth_service 做完。"""
    return {
        "user_id": int(x_user_id),
        "role": x_user_role,
        "tenant_id": int(x_tenant_id),
    }
