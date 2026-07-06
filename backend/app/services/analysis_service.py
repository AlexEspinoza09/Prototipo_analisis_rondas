"""Async analysis: route deviation, impossible speeds (rule 3) and guard
performance decline (rule 4). Called from Celery tasks; kept broker-free so
tests can exercise the logic directly against the database."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    Anomaly,
    AnomalySeverity,
    AnomalyType,
    PatrolSession,
    Route,
    SessionStatus,
    TelemetryPoint,
    User,
    UserRole,
)

# Densification fraction for ST_FrechetDistance: vertices-only comparison can
# underestimate on long straight segments.
FRECHET_DENSIFY_FRAC = 0.1

RECENT_WINDOW_DAYS = 7
PREVIOUS_WINDOW_DAYS = 21


# ---------------------------------------------------------------------------
# Rule 3: route deviation + impossible speed (per session, on session end)
# ---------------------------------------------------------------------------


def _session_frechet_distance_m(db: Session, session: PatrolSession) -> float | None:
    """Fréchet distance in meters between the actual track and the expected path."""
    actual_line = (
        select(
            func.ST_MakeLine(
                aggregate_order_by(
                    cast(TelemetryPoint.location, Geometry()), TelemetryPoint.recorded_at
                )
            )
        )
        .where(TelemetryPoint.session_id == session.id)
        .scalar_subquery()
    )
    return db.scalar(
        select(
            func.ST_FrechetDistance(
                func.ST_Transform(actual_line, settings.projection_srid),
                func.ST_Transform(
                    cast(Route.expected_path, Geometry()), settings.projection_srid
                ),
                FRECHET_DENSIFY_FRAC,
            )
        ).where(Route.id == session.route_id, Route.expected_path.isnot(None))
    )


@dataclass
class _SpeedRun:
    started_at: datetime
    ended_at: datetime
    duration_s: float
    max_speed_mps: float


def _find_impossible_speed_runs(db: Session, session_id: int) -> list[_SpeedRun]:
    """Consecutive-point implied speeds above the limit, sustained long enough."""
    rows = db.execute(
        text(
            """
            SELECT recorded_at,
                   ST_Distance(location, LAG(location) OVER w) AS dist_m,
                   EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_s
            FROM telemetry_points
            WHERE session_id = :session_id
            WINDOW w AS (ORDER BY recorded_at)
            ORDER BY recorded_at
            """
        ),
        {"session_id": session_id},
    ).all()

    runs: list[_SpeedRun] = []
    run_start: datetime | None = None
    run_end: datetime | None = None
    run_duration = 0.0
    run_max_speed = 0.0

    def close_run() -> None:
        nonlocal run_start, run_end, run_duration, run_max_speed
        if (
            run_start is not None
            and run_end is not None
            and run_duration >= settings.impossible_speed_min_duration_s
        ):
            runs.append(_SpeedRun(run_start, run_end, run_duration, run_max_speed))
        run_start = run_end = None
        run_duration = 0.0
        run_max_speed = 0.0

    for recorded_at, dist_m, dt_s in rows:
        if dist_m is None or dt_s is None or dt_s <= 0:
            close_run()
            continue
        speed = float(dist_m) / float(dt_s)
        if speed > settings.impossible_speed_mps:
            if run_start is None:
                run_start = recorded_at - timedelta(seconds=float(dt_s))
            run_end = recorded_at
            run_duration += float(dt_s)
            run_max_speed = max(run_max_speed, speed)
        else:
            close_run()
    close_run()
    return runs


def analyze_session_route(db: Session, session_id: int) -> list[Anomaly]:
    """Rule 3, executed by the worker when a session ends. Idempotent."""
    session = db.get(PatrolSession, session_id)
    if session is None:
        return []

    already_analyzed = db.scalar(
        select(func.count())
        .select_from(Anomaly)
        .where(
            Anomaly.session_id == session_id,
            Anomaly.type.in_([AnomalyType.route_deviation, AnomalyType.impossible_speed]),
        )
    )
    if already_analyzed:
        return []

    point_count = db.scalar(
        select(func.count())
        .select_from(TelemetryPoint)
        .where(TelemetryPoint.session_id == session_id)
    )
    if point_count < 2:
        return []

    anomalies: list[Anomaly] = []
    now = datetime.now(timezone.utc)

    frechet_m = _session_frechet_distance_m(db, session)
    if frechet_m is not None and frechet_m > settings.route_frechet_threshold_m:
        severity = (
            AnomalySeverity.high
            if frechet_m >= 2 * settings.route_frechet_threshold_m
            else AnomalySeverity.medium
        )
        anomalies.append(
            Anomaly(
                session_id=session_id,
                guard_id=session.guard_id,
                type=AnomalyType.route_deviation,
                severity=severity,
                detected_at=now,
                details={
                    "frechet_distance_m": round(frechet_m, 1),
                    "threshold_m": settings.route_frechet_threshold_m,
                    "route_id": session.route_id,
                    "point_count": point_count,
                },
            )
        )

    for run in _find_impossible_speed_runs(db, session_id):
        severity = (
            AnomalySeverity.high
            if run.max_speed_mps >= 2 * settings.impossible_speed_mps
            else AnomalySeverity.medium
        )
        anomalies.append(
            Anomaly(
                session_id=session_id,
                guard_id=session.guard_id,
                type=AnomalyType.impossible_speed,
                severity=severity,
                detected_at=now,
                details={
                    "started_at": run.started_at.isoformat(),
                    "ended_at": run.ended_at.isoformat(),
                    "duration_s": round(run.duration_s, 1),
                    "max_speed_mps": round(run.max_speed_mps, 2),
                    "speed_limit_mps": settings.impossible_speed_mps,
                    "min_duration_s": settings.impossible_speed_min_duration_s,
                },
            )
        )

    db.add_all(anomalies)
    db.commit()
    return anomalies


# ---------------------------------------------------------------------------
# Rule 4: performance decline (nightly, per guard)
# ---------------------------------------------------------------------------


def _guard_window_metrics(
    db: Session, guard_id: int, start: datetime, end: datetime
) -> dict[str, float]:
    completed = (
        PatrolSession.guard_id == guard_id,
        PatrolSession.status == SessionStatus.completed,
        PatrolSession.started_at >= start,
        PatrolSession.started_at < end,
    )
    rounds, active_s = db.execute(
        select(
            func.count(PatrolSession.id),
            func.coalesce(
                func.sum(func.extract("epoch", PatrolSession.ended_at - PatrolSession.started_at)),
                0.0,
            ),
        ).where(*completed)
    ).one()

    per_session_length = (
        select(
            func.ST_Length(
                cast(
                    func.ST_MakeLine(
                        aggregate_order_by(
                            cast(TelemetryPoint.location, Geometry()), TelemetryPoint.recorded_at
                        )
                    ),
                    Geography(),
                )
            ).label("len_m")
        )
        .join(PatrolSession, PatrolSession.id == TelemetryPoint.session_id)
        .where(*completed)
        .group_by(TelemetryPoint.session_id)
        .subquery()
    )
    distance_m = db.scalar(select(func.coalesce(func.sum(per_session_length.c.len_m), 0.0)))

    days = (end - start).days or 1
    return {
        "rounds_per_day": rounds / days,
        "distance_m_per_day": float(distance_m) / days,
        "active_min_per_day": float(active_s) / 60 / days,
    }


def _decline_severity(max_decline: float) -> AnomalySeverity:
    if max_decline >= 0.6:
        return AnomalySeverity.high
    if max_decline >= 0.45:
        return AnomalySeverity.medium
    return AnomalySeverity.low


def analyze_guards_performance(
    db: Session, reference: datetime | None = None
) -> list[Anomaly]:
    """Rule 4, executed nightly by Celery Beat. Idempotent per guard per day."""
    reference = reference or datetime.now(timezone.utc)
    recent_start = reference - timedelta(days=RECENT_WINDOW_DAYS)
    previous_start = recent_start - timedelta(days=PREVIOUS_WINDOW_DAYS)
    day_start = reference.replace(hour=0, minute=0, second=0, microsecond=0)

    guards = db.scalars(
        select(User).where(User.role == UserRole.guard, User.is_active.is_(True))
    ).all()

    anomalies: list[Anomaly] = []
    for guard in guards:
        already_flagged_today = db.scalar(
            select(func.count())
            .select_from(Anomaly)
            .where(
                Anomaly.guard_id == guard.id,
                Anomaly.type == AnomalyType.performance_decline,
                Anomaly.detected_at >= day_start,
            )
        )
        if already_flagged_today:
            continue

        previous = _guard_window_metrics(db, guard.id, previous_start, recent_start)
        recent = _guard_window_metrics(db, guard.id, recent_start, reference)

        metrics_detail: dict[str, Any] = {}
        max_decline = 0.0
        for metric, prev_value in previous.items():
            if prev_value <= 0:
                continue  # nothing to compare against
            recent_value = recent[metric]
            decline = (prev_value - recent_value) / prev_value
            metrics_detail[metric] = {
                "previous": round(prev_value, 2),
                "recent": round(recent_value, 2),
                "decline": round(decline, 3),
            }
            max_decline = max(max_decline, decline)

        if not metrics_detail or max_decline <= settings.performance_decline_ratio:
            continue

        anomalies.append(
            Anomaly(
                session_id=None,
                guard_id=guard.id,
                type=AnomalyType.performance_decline,
                severity=_decline_severity(max_decline),
                detected_at=reference,
                details={
                    "recent_window_days": RECENT_WINDOW_DAYS,
                    "previous_window_days": PREVIOUS_WINDOW_DAYS,
                    "metrics": metrics_detail,
                    "max_decline": round(max_decline, 3),
                    "threshold": settings.performance_decline_ratio,
                },
            )
        )

    db.add_all(anomalies)
    db.commit()
    return anomalies
