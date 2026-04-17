from fastapi import FastAPI

from routers import health, patients, inbody, food_logs, visits, notifications, line_webhook, upload

app = FastAPI(title="Bye-Weight API", version="1.0.0", docs_url="/docs")

app.include_router(health.router)
app.include_router(patients.router)
app.include_router(inbody.router)
app.include_router(food_logs.router)
app.include_router(visits.router)
app.include_router(notifications.router)
app.include_router(line_webhook.router)
app.include_router(upload.router)
