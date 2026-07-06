from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import (
    anomalies,
    auth,
    checkpoints,
    dashboard,
    routes,
    scans,
    sessions,
    sites,
    telemetry,
    users,
)
from app.core.config import settings
from app.core.db import get_db

app = FastAPI(title=settings.app_name, version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(telemetry.router)
app.include_router(scans.router)
app.include_router(anomalies.router)
app.include_router(dashboard.router)
app.include_router(sites.router)
app.include_router(checkpoints.router)
app.include_router(routes.router)
app.include_router(users.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict[str, str]:
    postgis_version = db.execute(text("SELECT PostGIS_Lib_Version()")).scalar_one()
    return {"status": "ok", "postgis": postgis_version}
