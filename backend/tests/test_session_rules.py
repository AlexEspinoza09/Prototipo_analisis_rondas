"""Business rules 5 (checkpoint timing and order), 6 (sensor coherence) and
7 (GPS quality), plus patrol-mode handling in rule 2, with synthetic data
against real PostGIS."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Anomaly,
    AnomalySeverity,
    AnomalyType,
    Checkpoint,
    PatrolMode,
    PatrolSession,
    Route,
    RouteCheckpoint,
    Scan,
    ScanInvalidReason,
    SessionStatus,
    Site,
    TelemetryPoint,
)
from app.services.analysis_service import analyze_session
from tests.factories import (
    CP_LAT,
    CP_LNG,
    auth_headers,
    create_guard,
    create_staff,
    lat_offset,
)

# Route with three checkpoints expected at minutes 0, 10 and 20; 25-minute round.
OFFSETS_MIN = (0, 10, 20)
ROUND_MIN = 25


def _route_with_checkpoints(
    db: Session, *, patrol_mode: PatrolMode = PatrolMode.foot, offsets=OFFSETS_MIN
) -> tuple[Route, list[Checkpoint]]:
    site = Site(name="Sitio reglas")
    db.add(site)
    db.flush()
    checkpoints = [
        Checkpoint(
            site_id=site.id,
            name=f"CP{i + 1}",
            qr_code=uuid.uuid4(),
            location=f"SRID=4326;POINT({CP_LNG} {CP_LAT + lat_offset(100 * i)})",
            radius_m=30,
        )
        for i in range(len(offsets))
    ]
    route = Route(
        site_id=site.id,
        name="Ruta reglas",
        expected_duration_min=ROUND_MIN,
        patrol_mode=patrol_mode,
    )
    db.add_all([*checkpoints, route])
    db.flush()
    db.add_all(
        RouteCheckpoint(
            route_id=route.id,
            checkpoint_id=cp.id,
            sequence_order=i + 1,
            expected_offset_min=offset,
        )
        for i, (cp, offset) in enumerate(zip(checkpoints, offsets))
    )
    db.commit()
    return route, checkpoints


def _session(db: Session, route: Route, duration_min: float) -> PatrolSession:
    started = datetime.now(timezone.utc) - timedelta(hours=2)
    session = PatrolSession(
        guard_id=create_guard(db).id,
        route_id=route.id,
        device_id="synthetic",
        status=SessionStatus.completed,
        started_at=started,
        ended_at=started + timedelta(minutes=duration_min),
    )
    db.add(session)
    db.commit()
    return session


def _still_telemetry(db: Session, session: PatrolSession, every_s: int = 60) -> None:
    """Stationary points covering the whole session: no gaps, no movement."""
    assert session.ended_at is not None
    t = session.started_at
    while t <= session.ended_at:
        db.add(
            TelemetryPoint(
                session_id=session.id,
                recorded_at=t,
                location=f"SRID=4326;POINT({CP_LNG} {CP_LAT})",
                accuracy_m=8.0,
            )
        )
        t += timedelta(seconds=every_s)
    db.commit()


def _scan(
    db: Session,
    session: PatrolSession,
    checkpoint: Checkpoint,
    minute: float,
    *,
    in_range: bool = True,
) -> None:
    db.add(
        Scan(
            session_id=session.id,
            checkpoint_id=checkpoint.id,
            scanned_at=session.started_at + timedelta(minutes=minute),
            scan_location=f"SRID=4326;POINT({CP_LNG} {CP_LAT})",
            distance_to_checkpoint_m=5.0 if in_range else 400.0,
            is_valid=in_range,
            invalid_reason=None if in_range else ScanInvalidReason.out_of_range,
        )
    )
    db.commit()


def _types(anomalies: list[Anomaly]) -> list[AnomalyType]:
    return sorted((a.type for a in anomalies), key=lambda t: t.value)


# ---------------------------------------------------------------------------
# Rule 5
# ---------------------------------------------------------------------------


def test_on_time_round_creates_no_anomalies(db, client):
    route, cps = _route_with_checkpoints(db)
    session = _session(db, route, ROUND_MIN)
    _still_telemetry(db, session)
    for cp, minute in zip(cps, (1, 11, 21)):
        _scan(db, session, cp, minute)

    assert analyze_session(db, session.id) == []


def test_segment_too_fast(db, client):
    route, cps = _route_with_checkpoints(db)
    session = _session(db, route, ROUND_MIN)
    _still_telemetry(db, session)
    # CP1 -> CP2 in 2 minutes instead of 10; CP2 -> CP3 in 18 (within 2x).
    for cp, minute in zip(cps, (1, 3, 21)):
        _scan(db, session, cp, minute)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.segment_too_fast]
    anomaly = anomalies[0]
    assert anomaly.severity == AnomalySeverity.high  # ratio 0.2 < 0.25
    assert anomaly.details["from_checkpoint"] == "CP1"
    assert anomaly.details["to_checkpoint"] == "CP2"
    assert anomaly.details["expected_min"] == 10
    assert anomaly.details["actual_min"] == 2


def test_segment_too_slow_and_round_too_long(db, client):
    route, cps = _route_with_checkpoints(db)
    session = _session(db, route, 50)
    _still_telemetry(db, session)
    # CP2 -> CP3 takes 35 minutes instead of 10; the round lasts 50 of 25.
    for cp, minute in zip(cps, (1, 11, 46)):
        _scan(db, session, cp, minute)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.round_too_long, AnomalyType.segment_too_slow]
    slow = next(a for a in anomalies if a.type == AnomalyType.segment_too_slow)
    assert slow.details["ratio"] == 3.5
    assert slow.severity == AnomalySeverity.low
    long_round = next(a for a in anomalies if a.type == AnomalyType.round_too_long)
    assert long_round.details["ratio"] == 2.0


def test_out_of_sequence_skips_segment_timing(db, client):
    route, cps = _route_with_checkpoints(db)
    session = _session(db, route, ROUND_MIN)
    _still_telemetry(db, session)
    # Visits CP1, CP3, CP2: order broken; stretches cannot be timed.
    for cp, minute in zip(cps, (1, 21, 11)):
        _scan(db, session, cp, minute)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.out_of_sequence]
    assert anomalies[0].details["actual_order"] == ["CP1", "CP3", "CP2"]
    assert anomalies[0].details["expected_order"] == ["CP1", "CP2", "CP3"]


def test_missed_checkpoint_counts_out_of_range_attempts(db, client):
    route, cps = _route_with_checkpoints(db)
    session = _session(db, route, ROUND_MIN)
    _still_telemetry(db, session)
    _scan(db, session, cps[0], 1)
    _scan(db, session, cps[1], 11, in_range=False)  # fraudulent attempt only
    _scan(db, session, cps[2], 21)

    anomalies = analyze_session(db, session.id)

    # CP1 -> CP3 still matches its expected 20 minutes.
    assert _types(anomalies) == [AnomalyType.missed_checkpoint]
    anomaly = anomalies[0]
    assert anomaly.severity == AnomalySeverity.medium  # 1 of 3
    assert anomaly.details["missed"] == [
        {"checkpoint": "CP2", "sequence_order": 2, "out_of_range_attempts": 1}
    ]


def test_round_too_short(db, client):
    route, _ = _route_with_checkpoints(db, offsets=())
    session = _session(db, route, 10)  # 10 of 25 minutes
    _still_telemetry(db, session)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.round_too_short]
    assert anomalies[0].severity == AnomalySeverity.medium  # ratio 0.4


def test_timeline_endpoint(db, client):
    route, cps = _route_with_checkpoints(db)
    session = _session(db, route, ROUND_MIN)
    for cp, minute in zip(cps, (1, 3, 21)):
        _scan(db, session, cp, minute)
    staff = create_staff(db)

    response = client.get(
        f"/sessions/{session.id}/timeline", headers=auth_headers(client, staff.email)
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["patrol_mode"] == "foot"
    assert body["expected_duration_min"] == ROUND_MIN
    assert body["out_of_sequence"] is False
    assert [cp["actual_offset_min"] for cp in body["checkpoints"]] == [1, 3, 21]
    assert [s["verdict"] for s in body["segments"]] == ["fast", "ok"]


# ---------------------------------------------------------------------------
# Rules 6 and 7: sensors and GPS quality (route without checkpoints)
# ---------------------------------------------------------------------------


def _moving_track(
    db: Session,
    session: PatrolSession,
    *,
    accel_std: float | None,
    gyro: float | None,
    n_points: int = 11,
    hole_after: int | None = None,
    spike_at: int | None = None,
) -> None:
    """Walk north at ~1.5 m/s, one point every 15 s from the session start."""
    t = session.started_at
    for i in range(n_points):
        if hole_after is not None and i == hole_after:
            t += timedelta(minutes=5)
        lng = CP_LNG + (0.0027 if i == spike_at else 0.0)  # ~300 m east
        db.add(
            TelemetryPoint(
                session_id=session.id,
                recorded_at=t,
                location=f"SRID=4326;POINT({lng} {CP_LAT + lat_offset(22.0 * i)})",
                accuracy_m=8.0,
                accel_magnitude=1.5,
                accel_std=accel_std,
                gyro_magnitude=gyro,
                is_moving=True,
            )
        )
        t += timedelta(seconds=15)
    db.commit()


def _track_session(db: Session, minutes: float) -> PatrolSession:
    route, _ = _route_with_checkpoints(db, offsets=())
    route.expected_duration_min = max(1, round(minutes))
    db.commit()
    return _session(db, route, minutes)


def test_sensor_mismatch_when_phone_still_but_gps_moves(db, client):
    session = _track_session(db, 2.75)
    _moving_track(db, session, accel_std=0.01, gyro=0.005)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.sensor_mismatch]
    assert anomalies[0].details["total_duration_s"] >= 60


def test_normal_sensors_while_walking_create_no_mismatch(db, client):
    session = _track_session(db, 2.75)
    _moving_track(db, session, accel_std=1.1, gyro=0.6)

    assert analyze_session(db, session.id) == []


def test_missing_sensor_window_is_not_judged(db, client):
    session = _track_session(db, 2.75)
    _moving_track(db, session, accel_std=None, gyro=None)

    assert analyze_session(db, session.id) == []


def test_telemetry_gap_detected(db, client):
    session = _track_session(db, 7.75)
    _moving_track(db, session, accel_std=1.1, gyro=0.6, hole_after=5)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.telemetry_gap]
    anomaly = anomalies[0]
    assert anomaly.details["gap_count"] == 1
    assert anomaly.details["gaps"][0]["duration_s"] == 315
    assert anomaly.severity == AnomalySeverity.high  # 315 s of 465 s


def test_gps_spike_is_a_jump_not_speed_or_deviation(db, client):
    session = _track_session(db, 2.75)
    # Expected path right along the track: only the spike could deviate.
    route = db.get(Route, session.route_id)
    route.expected_path = (
        f"SRID=4326;LINESTRING({CP_LNG} {CP_LAT}, {CP_LNG} {CP_LAT + lat_offset(220)})"
    )
    db.commit()
    _moving_track(db, session, accel_std=1.1, gyro=0.6, spike_at=5)

    anomalies = analyze_session(db, session.id)

    assert _types(anomalies) == [AnomalyType.gps_jump]
    anomaly = anomalies[0]
    assert anomaly.severity == AnomalySeverity.high  # precise fix: suspicious
    assert anomaly.details["jumps"][0]["kind"] == "spike"


# ---------------------------------------------------------------------------
# Rule 2 with patrol modes, and the API surface for patrol modes / sensors
# ---------------------------------------------------------------------------


def _scan_after_smooth_ride(db: Session, client, patrol_mode: PatrolMode) -> dict:
    """Low acceleration (smooth ride) over 5 minutes covering ~600 m."""
    route, cps = _route_with_checkpoints(db, patrol_mode=patrol_mode, offsets=(0,))
    guard = create_guard(db)
    now = datetime.now(timezone.utc)
    session = PatrolSession(
        guard_id=guard.id,
        route_id=route.id,
        device_id="test-device",
        status=SessionStatus.in_progress,
        started_at=now - timedelta(minutes=10),
    )
    db.add(session)
    db.flush()
    for i in range(10):
        db.add(
            TelemetryPoint(
                session_id=session.id,
                recorded_at=now - timedelta(seconds=300 - 30 * i),
                location=f"SRID=4326;POINT({CP_LNG} {CP_LAT - lat_offset(600 - 60 * i)})",
                accuracy_m=8.0,
                accel_magnitude=0.6,
                is_moving=False,
            )
        )
    db.commit()
    response = client.post(
        "/scans",
        json={
            "session_id": session.id,
            "qr_code": str(cps[0].qr_code),
            "lat": CP_LAT,
            "lng": CP_LNG,
        },
        headers=auth_headers(client, guard.email),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_vehicle_patrol_scan_after_ride_is_valid(db, client):
    body = _scan_after_smooth_ride(db, client, PatrolMode.vehicle)

    assert body["is_valid"] is True
    assert db.scalars(select(Anomaly)).all() == []


def test_foot_patrol_scan_after_same_ride_is_inactivity(db, client):
    body = _scan_after_smooth_ride(db, client, PatrolMode.foot)

    assert body["invalid_reason"] == "no_prior_movement"
    anomaly = db.scalars(select(Anomaly)).one()
    assert anomaly.type == AnomalyType.inactivity
    assert anomaly.details["patrol_mode"] == "foot"


def test_telemetry_batch_stores_sensor_fields(db, client):
    route, _ = _route_with_checkpoints(db, offsets=())
    guard = create_guard(db)
    session = PatrolSession(
        guard_id=guard.id,
        route_id=route.id,
        device_id="test-device",
        status=SessionStatus.in_progress,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()

    response = client.post(
        "/telemetry/batch",
        json={
            "session_id": session.id,
            "points": [
                {
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                    "lat": CP_LAT,
                    "lng": CP_LNG,
                    "accuracy_m": 6.0,
                    "accel_magnitude": 1.8,
                    "accel_std": 0.9,
                    "gyro_magnitude": 0.45,
                    "is_moving": True,
                }
            ],
        },
        headers=auth_headers(client, guard.email),
    )

    assert response.status_code == 200, response.text
    point = db.scalars(select(TelemetryPoint)).one()
    assert point.accel_std == 0.9
    assert point.gyro_magnitude == 0.45


def test_route_patrol_mode_roundtrip(db, client):
    staff = create_staff(db)
    headers = auth_headers(client, staff.email)
    site = Site(name="Sitio modo")
    db.add(site)
    db.commit()

    created = client.post(
        "/routes",
        json={"site_id": site.id, "name": "Ronda en moto", "expected_duration_min": 40,
              "patrol_mode": "vehicle"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["patrol_mode"] == "vehicle"

    updated = client.patch(
        f"/routes/{created.json()['id']}", json={"patrol_mode": "foot"}, headers=headers
    )
    assert updated.json()["patrol_mode"] == "foot"
