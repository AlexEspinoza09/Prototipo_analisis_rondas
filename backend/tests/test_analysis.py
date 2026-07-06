"""Business rules 3 (route deviation, impossible speed) and 4 (performance
decline), exercised with synthetic telemetry against real PostGIS."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Anomaly,
    AnomalySeverity,
    AnomalyType,
    PatrolSession,
    Route,
    SessionStatus,
    Site,
    TelemetryPoint,
    User,
)
from app.services.analysis_service import analyze_guards_performance, analyze_session_route
from tests.factories import CP_LAT, CP_LNG, create_guard, lat_offset

# Straight ~220 m south-to-north expected path starting at the reference point.
PATH_LENGTH_M = 220.0
EXPECTED_PATH = (
    f"SRID=4326;LINESTRING({CP_LNG} {CP_LAT}, {CP_LNG} {CP_LAT + lat_offset(PATH_LENGTH_M)})"
)


def _make_route_session(
    db: Session, *, expected_path: str | None = EXPECTED_PATH
) -> tuple[User, PatrolSession]:
    guard = create_guard(db)
    site = Site(name="Sitio análisis")
    db.add(site)
    db.flush()
    route = Route(
        site_id=site.id,
        name="Ruta análisis",
        expected_path=expected_path,
        expected_duration_min=30,
    )
    db.add(route)
    db.flush()
    session = PatrolSession(
        guard_id=guard.id,
        route_id=route.id,
        device_id="synthetic",
        status=SessionStatus.completed,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        ended_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    return guard, session


def _add_track(
    db: Session,
    session: PatrolSession,
    *,
    lng_offset_deg: float = 0.0,
    step_m: float = 22.0,
    interval_s: int = 15,
    n_points: int = 11,
) -> None:
    """Track along the expected path, optionally shifted sideways in longitude."""
    base_time = session.started_at
    for i in range(n_points):
        db.add(
            TelemetryPoint(
                session_id=session.id,
                recorded_at=base_time + timedelta(seconds=interval_s * i),
                location=(
                    f"SRID=4326;POINT({CP_LNG + lng_offset_deg} "
                    f"{CP_LAT + lat_offset(step_m * i)})"
                ),
                accuracy_m=8.0,
                accel_magnitude=2.0,
                is_moving=True,
            )
        )
    db.commit()


def test_track_on_route_creates_no_anomalies(db, client):
    _, session = _make_route_session(db)
    # 22 m every 15 s = 1.47 m/s, right on the path.
    _add_track(db, session)

    anomalies = analyze_session_route(db, session.id)

    assert anomalies == []
    assert db.scalars(select(Anomaly)).all() == []


def test_deviated_track_creates_route_deviation(db, client):
    _, session = _make_route_session(db)
    # Same shape but ~222 m to the west of the expected path.
    _add_track(db, session, lng_offset_deg=-0.002)

    anomalies = analyze_session_route(db, session.id)

    assert len(anomalies) == 1
    anomaly = anomalies[0]
    assert anomaly.type == AnomalyType.route_deviation
    assert anomaly.severity == AnomalySeverity.high  # >= 2x the 100 m threshold
    assert anomaly.details["frechet_distance_m"] > 100
    assert anomaly.details["threshold_m"] == 100


def test_impossible_speed_detected(db, client):
    # No expected path: isolates the speed check from the Fréchet check.
    _, session = _make_route_session(db, expected_path=None)
    # ~120 m every 15 s = ~8 m/s sustained for 150 s (>= 2x limit -> high).
    _add_track(db, session, step_m=120.0, n_points=11)

    anomalies = analyze_session_route(db, session.id)

    assert len(anomalies) == 1
    anomaly = anomalies[0]
    assert anomaly.type == AnomalyType.impossible_speed
    assert anomaly.severity == AnomalySeverity.high
    assert anomaly.details["max_speed_mps"] > 3.5
    assert anomaly.details["duration_s"] >= 30


def test_route_analysis_is_idempotent(db, client):
    _, session = _make_route_session(db)
    _add_track(db, session, lng_offset_deg=-0.002)

    first = analyze_session_route(db, session.id)
    second = analyze_session_route(db, session.id)

    assert len(first) == 1
    assert second == []
    assert len(db.scalars(select(Anomaly)).all()) == 1


def _add_completed_session(
    db: Session,
    guard: User,
    route: Route,
    started_at: datetime,
    *,
    duration_min: int = 30,
    distance_m: float = 400.0,
) -> None:
    session = PatrolSession(
        guard_id=guard.id,
        route_id=route.id,
        device_id="synthetic",
        status=SessionStatus.completed,
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=duration_min),
    )
    db.add(session)
    db.flush()
    for i, meters in enumerate((0.0, distance_m)):
        db.add(
            TelemetryPoint(
                session_id=session.id,
                recorded_at=started_at + timedelta(minutes=duration_min * i),
                location=f"SRID=4326;POINT({CP_LNG} {CP_LAT + lat_offset(meters)})",
                accuracy_m=8.0,
            )
        )


def test_performance_decline_detected(db, client):
    guard, session = _make_route_session(db)
    # Keep the helper's fresh session out of the recent-window metrics.
    session.status = SessionStatus.abandoned
    db.commit()
    route = db.get(Route, session.route_id)
    now = datetime.now(timezone.utc)

    # Active previous window (one round every ~3 days), silent recent window.
    for days_ago in (27, 24, 21, 18, 15, 12, 10):
        _add_completed_session(db, guard, route, now - timedelta(days=days_ago))
    db.commit()

    anomalies = analyze_guards_performance(db, reference=now)

    assert len(anomalies) == 1
    anomaly = anomalies[0]
    assert anomaly.type == AnomalyType.performance_decline
    assert anomaly.severity == AnomalySeverity.high  # activity dropped to zero
    assert anomaly.guard_id == guard.id
    assert anomaly.details["max_decline"] > 0.3
    assert anomaly.details["metrics"]["rounds_per_day"]["recent"] == 0


def test_stable_performance_creates_no_anomaly(db, client):
    guard, session = _make_route_session(db)
    route = db.get(Route, session.route_id)
    now = datetime.now(timezone.utc)

    # Same pace in both windows: one round every ~7 days.
    for days_ago in (25, 18, 11):
        _add_completed_session(db, guard, route, now - timedelta(days=days_ago))
    _add_completed_session(db, guard, route, now - timedelta(days=4))
    db.commit()

    anomalies = analyze_guards_performance(db, reference=now)

    assert anomalies == []


def test_performance_analysis_is_idempotent_per_day(db, client):
    guard, session = _make_route_session(db)
    route = db.get(Route, session.route_id)
    now = datetime.now(timezone.utc)
    for days_ago in (27, 20, 13):
        _add_completed_session(db, guard, route, now - timedelta(days=days_ago))
    db.commit()

    first = analyze_guards_performance(db, reference=now)
    second = analyze_guards_performance(db, reference=now)

    assert len(first) == 1
    assert second == []
