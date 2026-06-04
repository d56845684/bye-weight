from fastapi import FastAPI

from routers import (
    health, patients, inbody, food_logs, visits, notifications, line_webhook, upload,
    patient_goals, blood_test,
)
import utils.tenant_guard  # noqa: F401  — 啟用 tenant filter event listener

# root_path 對應 nginx 的 /api/v1 前綴:讓 OpenAPI spec 的 servers 與
# Swagger UI 的「Try it out」自動補上 /api/v1,呼叫不會 404。
app = FastAPI(
    title="Bye-Weight API",
    version="1.0.0",
    root_path="/api/v1",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.include_router(health.router)
app.include_router(patients.router)
app.include_router(inbody.router)
app.include_router(food_logs.router)
app.include_router(visits.router)
app.include_router(notifications.router)
app.include_router(line_webhook.router)
app.include_router(upload.router)
app.include_router(patient_goals.router)
app.include_router(blood_test.router)
