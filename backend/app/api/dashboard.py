from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_roles
from app.models import Anomaly, PatrolSession, Scan, SessionStatus, User, UserRole

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_staff = require_roles(UserRole.admin, UserRole.supervisor)

_valid_as_float = case((Scan.is_valid, 1.0), else_=0.0)


@router.get("/summary")
def summary(
    days: int = Query(default=14, ge=1, le=90),
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    week_ago = now - timedelta(days=7)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    session_day = func.date_trunc("day", PatrolSession.started_at)
    sessions_per_day = [
        {"date": day.date().isoformat(), "count": count}
        for day, count in db.execute(
            select(session_day, func.count())
            .where(PatrolSession.started_at >= since)
            .group_by(session_day)
            .order_by(session_day)
        )
    ]

    scan_day = func.date_trunc("day", Scan.scanned_at)
    scans_per_day = [
        {"date": day.date().isoformat(), "valid": valid, "invalid": invalid}
        for day, valid, invalid in db.execute(
            select(
                scan_day,
                func.count().filter(Scan.is_valid.is_(True)),
                func.count().filter(Scan.is_valid.is_(False)),
            )
            .where(Scan.scanned_at >= since)
            .group_by(scan_day)
            .order_by(scan_day)
        )
    ]

    anomalies_by_type = [
        {"type": anomaly_type.value, "count": count}
        for anomaly_type, count in db.execute(
            select(Anomaly.type, func.count())
            .where(Anomaly.detected_at >= since)
            .group_by(Anomaly.type)
            .order_by(func.count().desc())
        )
    ]

    valid_pct_7d = db.scalar(
        select(func.avg(_valid_as_float)).where(Scan.scanned_at >= week_ago)
    )

    totals = {
        "sessions_today": db.scalar(
            select(func.count())
            .select_from(PatrolSession)
            .where(PatrolSession.started_at >= today_start)
        ),
        "sessions_7d": db.scalar(
            select(func.count())
            .select_from(PatrolSession)
            .where(PatrolSession.started_at >= week_ago)
        ),
        "valid_scan_pct_7d": round(float(valid_pct_7d) * 100, 1) if valid_pct_7d is not None else None,
        "open_anomalies": db.scalar(
            select(func.count()).select_from(Anomaly).where(Anomaly.reviewed.is_(False))
        ),
    }

    sessions_7d_by_guard = dict(
        db.execute(
            select(PatrolSession.guard_id, func.count())
            .where(
                PatrolSession.started_at >= week_ago,
                PatrolSession.status == SessionStatus.completed,
            )
            .group_by(PatrolSession.guard_id)
        ).all()
    )
    valid_pct_by_guard = dict(
        db.execute(
            select(PatrolSession.guard_id, func.avg(_valid_as_float))
            .join(Scan, Scan.session_id == PatrolSession.id)
            .where(Scan.scanned_at >= week_ago)
            .group_by(PatrolSession.guard_id)
        ).all()
    )
    anomalies_7d_by_guard = dict(
        db.execute(
            select(Anomaly.guard_id, func.count())
            .where(Anomaly.detected_at >= week_ago)
            .group_by(Anomaly.guard_id)
        ).all()
    )

    guard_activity = [
        {
            "guard_id": guard.id,
            "guard_name": guard.full_name,
            "sessions_7d": sessions_7d_by_guard.get(guard.id, 0),
            "valid_scan_pct_7d": (
                round(float(valid_pct_by_guard[guard.id]) * 100, 1)
                if guard.id in valid_pct_by_guard
                else None
            ),
            "anomalies_7d": anomalies_7d_by_guard.get(guard.id, 0),
        }
        for guard in db.scalars(
            select(User).where(User.role == UserRole.guard, User.is_active.is_(True))
        )
    ]

    return {
        "window_days": days,
        "totals": totals,
        "sessions_per_day": sessions_per_day,
        "scans_per_day": scans_per_day,
        "anomalies_by_type": anomalies_by_type,
        "guard_activity": guard_activity,
    }
