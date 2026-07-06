import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_roles
from app.models import (
    Checkpoint,
    PatrolSession,
    Route,
    Scan,
    SessionStatus,
    TelemetryPoint,
    User,
    UserRole,
)
from app.schemas.scan import SessionScanOut
from app.schemas.session import SessionListOut, SessionOut, SessionStartIn
from app.tasks.analysis import analyze_session_route_task

logger = logging.getLogger(__name__)

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


@router.get("/mine", response_model=list[SessionListOut])
def my_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 50,
) -> list[SessionListOut]:
    """Session history for the authenticated guard (mobile app)."""
    rows = db.execute(
        select(PatrolSession, User.full_name, Route.name)
        .join(User, PatrolSession.guard_id == User.id)
        .join(Route, PatrolSession.route_id == Route.id)
        .where(PatrolSession.guard_id == user.id)
        .order_by(PatrolSession.started_at.desc())
        .limit(min(limit, 200))
    )
    return [
        SessionListOut(
            **SessionOut.model_validate(session).model_dump(),
            guard_name=guard_name,
            route_name=route_name,
        )
        for session, guard_name, route_name in rows
    ]


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
    try:
        analyze_session_route_task.delay(session.id)
    except Exception:  # a broker outage must not break the mobile flow
        logger.warning("Could not enqueue route analysis for session %s", session.id)
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


@router.get("", response_model=list[SessionListOut])
def list_sessions(
    user: User = Depends(require_roles(UserRole.admin, UserRole.supervisor)),
    db: Session = Depends(get_db),
    limit: int = 50,
) -> list[SessionListOut]:
    rows = db.execute(
        select(PatrolSession, User.full_name, Route.name)
        .join(User, PatrolSession.guard_id == User.id)
        .join(Route, PatrolSession.route_id == Route.id)
        .order_by(PatrolSession.started_at.desc())
        .limit(min(limit, 200))
    )
    return [
        SessionListOut(
            **SessionOut.model_validate(session).model_dump(),
            guard_name=guard_name,
            route_name=route_name,
        )
        for session, guard_name, route_name in rows
    ]


@router.get("/{session_id}/scans", response_model=list[SessionScanOut])
def session_scans(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SessionScanOut]:
    session = _get_session_authorized(db, session_id, user)
    rows = db.execute(
        select(Scan, Checkpoint.name)
        .join(Checkpoint, Scan.checkpoint_id == Checkpoint.id)
        .where(Scan.session_id == session.id)
        .order_by(Scan.scanned_at)
    )
    return [
        SessionScanOut(
            id=scan.id,
            checkpoint_id=scan.checkpoint_id,
            checkpoint_name=checkpoint_name,
            scanned_at=scan.scanned_at,
            is_valid=scan.is_valid,
            invalid_reason=scan.invalid_reason,
            distance_to_checkpoint_m=round(scan.distance_to_checkpoint_m, 1),
        )
        for scan, checkpoint_name in rows
    ]
