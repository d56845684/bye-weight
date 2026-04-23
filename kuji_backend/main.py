from fastapi import FastAPI

from routers import health, meetings, tasks, integrations, team, me

app = FastAPI(title="Kuji Backend API", version="0.1.0", docs_url="/docs")

app.include_router(health.router)
app.include_router(meetings.router)
app.include_router(tasks.router)
app.include_router(integrations.router)
app.include_router(team.router)
app.include_router(me.router)
