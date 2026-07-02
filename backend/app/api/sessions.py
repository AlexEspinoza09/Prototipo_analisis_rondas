import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_roles
from app.models import PatrolSession, Route, SessionStatus, TelemetryPoint, User, UserRole
from app.schemas.session import SessionOut, SessionStartIn

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _get_session_authorized(db: Session, session_id: int, user: User) -> PatrolSession:
    session = db.get(PatrolSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if user.role == UserRole.guard and session.guard_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Session belongs to another guard"
        )
    return session


@router.post("/start", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def start_session(
    payload: SessionStartIn,
    user: User = Depends(require_roles(UserRole.guard)),
    db: Session = Depends(get_db),
) -> PatrolSession:
    route = db.get(Route, payload.route_id)
    if route is None or not route.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")

    in_progress = db.scalar(
        select(PatrolSession).where(
            PatrolSession.guard_id == user.id,
            PatrolSession.status == SessionStatus.in_progress,
        )
    )
    if in_progress is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Guard already has session {in_progress.id} in progress",
        )

    session = PatrolSession(
        guard_id=user.id,
        route_id=route.id,
        device_id=payload.device_id,
        status=SessionStatus.in_progress,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/end", response_model=SessionOut)
def end_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PatrolSession:
    session = _get_session_authorized(db, session_id, user)
    if session.status != SessionStatus.in_progress:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Session is not in progress"
        )
    session.ended_at = datetime.now(timezone.utc)
    session.status = SessionStatus.completed
    db.commit()
    db.refresh(session)
    # Etapa 3: enqueue the Celery route-analysis task here (rule 3).
    return session


@router.get("/{session_id}/track")
def session_track(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """GeoJSON Feature with the session trajectory as a LineString."""
    session = _get_session_authorized(db, session_id, user)

    point_count, line_geojson = db.execute(
        select(
            func.count(),
            func.ST_AsGeoJSON(
                func.ST_MakeLine(
                    aggregate_order_by(
                        cast(TelemetryPoint.location, Geometry()), TelemetryPoint.recorded_at
                    )
                )
            ),
        ).where(TelemetryPoint.session_id == session.id)
    ).one()

    return {
        "type": "Feature",
        "geometry": json.loads(line_geojson) if line_geojson else None,
        "properties": {
            "session_id": session.id,
            "guard_id": session.guard_id,
            "route_id": session.route_id,
            "status": session.status.value,
            "started_at": session.started_at.isoformat(),
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "point_count": point_count,
        },
    }


@router.get("", response_model=list[SessionOut])
def list_sessions(
    user: User = Depends(require_roles(UserRole.admin, UserRole.supervisor)),
    db: Session = Depends(get_db),
    limit: int = 50,
) -> list[PatrolSession]:
    return list(
        db.scalars(
            select(PatrolSession).order_by(PatrolSession.started_at.desc()).limit(min(limit, 200))
        )
    )
