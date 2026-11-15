"""Synthetic demo patrols: dashboard exploration and controlled evaluation.

Generates two weeks of realistic patrol sessions over the seeded route:
walking pace with GPS jitter, phone sensor readings (acceleration, its
variability and rotation), dwell at each checkpoint, real scans through the
scan service (so rules 1 and 2 run authentically) and the session analysis
(rules 3, 5, 6 and 7) executed synchronously.

Most sessions are normal; one controlled scenario per kind of anomaly is
injected. At the end the script prints an evaluation matrix comparing the
anomalies each scenario should trigger against the ones actually detected.

Run inside the api container (idempotent — wipes previous demo data first):
    docker compose exec api python -m app.demo_data
"""

import math
import random
from datetime import datetime, timedelta, timezone

from geoalchemy2 import Geometry
from sqlalchemy import cast, delete, func, select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models import (
    Anomaly,
    AnomalyType,
    Checkpoint,
    PatrolSession,
    Route,
    RouteCheckpoint,
    Scan,
    SessionStatus,
    TelemetryPoint,
    User,
)
from app.seeds import GUARD_EMAILS
from app.services.analysis_service import analyze_session
from app.services.scan_service import process_scan

DEMO_DEVICE = "demo-data"
DEMO_DAYS = 14
WALK_SPEED_MPS = 1.3
RUSH_SPEED_MPS = 2.6  # jogging: under the impossible-speed limit, but rushed
VEHICLE_SPEED_MPS = 8.0
POINT_INTERVAL_S = 15
LONG_BREAK_S = 15 * 60
GPS_SPIKE_M = 300.0

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LNG = 111_320.0  # near the equator

Coord = tuple[float, float]  # (lng, lat)

# Phone sensor profiles: (accel_magnitude, accel_std, gyro_magnitude) means.
SENSOR_WALK = (2.2, 1.1, 0.6)
SENSOR_IN_HAND = (0.5, 0.25, 0.12)  # standing / sitting with the phone on them
SENSOR_STATIC = (0.04, 0.012, 0.004)  # phone lying on a table

# Anomalies each scenario is designed to trigger (ground truth for evaluation).
EXPECTED: dict[str, set[AnomalyType]] = {
    "normal": set(),
    "fraud_cp2": {AnomalyType.fraudulent_scan, AnomalyType.missed_checkpoint},
    "inactivity_cp2": {AnomalyType.inactivity},
    "detour_skip_cp3": {AnomalyType.route_deviation, AnomalyType.missed_checkpoint},
    "fast_skip_cp3": {
        AnomalyType.impossible_speed,
        AnomalyType.missed_checkpoint,
        AnomalyType.segment_too_fast,
    },
    "rushed": {AnomalyType.segment_too_fast, AnomalyType.round_too_short},
    "long_break": {AnomalyType.segment_too_slow, AnomalyType.round_too_long},
    "reverse_order": {AnomalyType.out_of_sequence, AnomalyType.route_deviation},
    "phone_static": {AnomalyType.sensor_mismatch, AnomalyType.inactivity},
    "gps_off": {AnomalyType.telemetry_gap},
    "gps_jump": {AnomalyType.gps_jump},
}

# (days_ago, guard_index) -> scenario; every other session is "normal".
SPECIAL_SESSIONS = {
    (12, 0): "rushed",
    (11, 1): "reverse_order",
    (10, 0): "gps_off",
    (9, 1): "gps_jump",
    (8, 0): "long_break",
    (7, 1): "phone_static",
    (4, 0): "fast_skip_cp3",
    (3, 1): "detour_skip_cp3",
    (2, 0): "fraud_cp2",
    (1, 1): "inactivity_cp2",
}


def _meters(a: Coord, b: Coord) -> float:
    dx = (b[0] - a[0]) * M_PER_DEG_LNG
    dy = (b[1] - a[1]) * M_PER_DEG_LAT
    return math.hypot(dx, dy)


def _lerp(a: Coord, b: Coord, f: float) -> Coord:
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def _jitter(pos: Coord, rng: random.Random, sigma_m: float = 4.0) -> Coord:
    return (
        pos[0] + rng.gauss(0, sigma_m / M_PER_DEG_LNG),
        pos[1] + rng.gauss(0, sigma_m / M_PER_DEG_LAT),
    )


class SessionBuilder:
    def __init__(self, start: datetime, rng: random.Random) -> None:
        self.rng = rng
        self.t = start
        self.points: list[dict] = []
        self.scan_plan: list[tuple[int, Coord, datetime]] = []

    def _sensor_features(self, moving: bool) -> dict:
        """Window features consistent with the activity, mirroring what the app
        computes on-device: walking is high-dispersion and rhythmic around 2 Hz,
        a resting phone is neither."""
        g = self.rng.gauss
        if moving:
            return {
                "gyro_magnitude": max(0.0, g(1.4, 0.3)),
                "accel_std": max(0.05, g(1.2, 0.25)),
                "accel_max": max(0.5, g(6.0, 1.2)),
                "gyro_std": max(0.02, g(0.8, 0.2)),
                "gyro_max": max(0.1, g(4.0, 0.9)),
                "accel_dominant_hz": min(5.0, max(0.5, g(1.9, 0.25))),
                "accel_peak_ratio": min(1.0, max(0.0, g(0.35, 0.07))),
                "gyro_dominant_hz": min(5.0, max(0.5, g(1.9, 0.3))),
                "gyro_peak_ratio": min(1.0, max(0.0, g(0.30, 0.07))),
                "sensor_sample_count": max(30, round(g(98, 6))),
            }
        return {
            "gyro_magnitude": max(0.0, g(0.05, 0.02)),
            "accel_std": max(0.0, g(0.09, 0.03)),
            "accel_max": max(0.0, g(0.7, 0.2)),
            "gyro_std": max(0.0, g(0.03, 0.01)),
            "gyro_max": max(0.0, g(0.2, 0.06)),
            # No cadence to lock onto: the peak lands anywhere and carries little
            # of the band's power.
            "accel_dominant_hz": self.rng.uniform(0.5, 5.0),
            "accel_peak_ratio": min(1.0, max(0.0, g(0.06, 0.02))),
            "gyro_dominant_hz": self.rng.uniform(0.5, 5.0),
            "gyro_peak_ratio": min(1.0, max(0.0, g(0.06, 0.02))),
            "sensor_sample_count": max(30, round(g(98, 6))),
        }

    def _add_point(
        self,
        pos: Coord,
        *,
        speed: float,
        sensors: tuple[float, float, float],
        accuracy_m: float | None = None,
    ) -> None:
        lng, lat = _jitter(pos, self.rng)
        accel, accel_std, gyro = sensors
        accel_value = max(0.01, self.rng.gauss(accel, accel * 0.15))
        # Same rule the app uses: mean deviation from gravity > 0.8 m/s^2
        is_moving = accel_value > 0.8
        self.points.append(
            {
                "recorded_at": self.t,
                "location": f"SRID=4326;POINT({lng} {lat})",
                "accuracy_m": accuracy_m or self.rng.uniform(5, 12),
                "speed_mps": max(0.0, speed + self.rng.gauss(0, 0.15)),
                "accel_magnitude": round(accel_value, 3),
                # Rhythm and peak features for the activity dataset...
                **self._sensor_features(is_moving),
                # ...while the scenario decides the ones the fraud rules read.
                "accel_std": round(max(0.001, self.rng.gauss(accel_std, accel_std * 0.2)), 4),
                "gyro_magnitude": round(max(0.0005, self.rng.gauss(gyro, gyro * 0.25)), 4),
                "is_moving": is_moving,
            }
        )

    def walk(
        self,
        start: Coord,
        end: Coord,
        *,
        speed: float = WALK_SPEED_MPS,
        sensors: tuple[float, float, float] = SENSOR_WALK,
        record: bool = True,
        spike_at: float | None = None,
    ) -> None:
        """Move from start to end. record=False simulates the GPS being off;
        spike_at places one far-off GPS outlier at that fraction of the way."""
        steps = max(1, round(_meters(start, end) / speed / POINT_INTERVAL_S))
        spike_step = round(steps * spike_at) if spike_at is not None else None
        for i in range(1, steps + 1):
            self.t += timedelta(seconds=POINT_INTERVAL_S)
            if not record:
                continue
            pos = _lerp(start, end, i / steps)
            if i == spike_step:
                pos = (pos[0] + GPS_SPIKE_M / M_PER_DEG_LNG, pos[1])
            self._add_point(pos, speed=speed, sensors=sensors)

    def dwell(
        self, pos: Coord, seconds: int, *, sensors: tuple[float, float, float] = SENSOR_IN_HAND
    ) -> None:
        for _ in range(max(1, seconds // POINT_INTERVAL_S)):
            self.t += timedelta(seconds=POINT_INTERVAL_S)
            self._add_point(pos, speed=0.0, sensors=sensors)

    def scan(self, checkpoint_id: int, pos: Coord, *, offset_m: float = 6.0) -> None:
        lng, lat = _jitter(pos, self.rng, sigma_m=offset_m)
        self.scan_plan.append((checkpoint_id, (lng, lat), self.t))


def _route_checkpoints(db: Session, route: Route) -> list[tuple[Checkpoint, Coord]]:
    geom = cast(Checkpoint.location, Geometry())
    rows = db.execute(
        select(Checkpoint, func.ST_X(geom), func.ST_Y(geom))
        .join(RouteCheckpoint, RouteCheckpoint.checkpoint_id == Checkpoint.id)
        .where(RouteCheckpoint.route_id == route.id)
        .order_by(RouteCheckpoint.sequence_order)
    ).all()
    return [(cp, (lng, lat)) for cp, lng, lat in rows]


def _build(
    scenario: str,
    cps: list[tuple[Checkpoint, Coord]],
    start: datetime,
    rng: random.Random,
) -> SessionBuilder:
    b = SessionBuilder(start, rng)
    (cp1, p1), (cp2, p2), (cp3, p3), (cp4, p4) = cps
    rushed = scenario == "rushed"
    pace = RUSH_SPEED_MPS if rushed else WALK_SPEED_MPS

    def stop_and_scan(cp: Checkpoint, pos: Coord) -> None:
        if not rushed:  # a rushed guard scans without stopping
            b.dwell(pos, 30)
        b.scan(cp.id, pos)

    # Approach walk so rule 2 sees movement before the first scan. Kept well
    # under the 100 m Fréchet threshold so it does not read as a deviation.
    b.walk((p1[0], p1[1] - 60 / M_PER_DEG_LAT), p1, speed=pace)
    stop_and_scan(cp1, p1)

    if scenario == "reverse_order":
        # Walks the perimeter the other way round.
        for cp, (frm, to) in ((cp4, (p1, p4)), (cp3, (p4, p3)), (cp2, (p3, p2))):
            b.walk(frm, to)
            stop_and_scan(cp, to)
        b.walk(p2, p1)
        return b

    # Stretch 1 -> 2
    if scenario == "gps_off":
        # GPS disabled for most of the stretch, back on before the checkpoint.
        q = _lerp(p1, p2, 0.75)
        b.walk(p1, q, record=False)
        b.walk(q, p2)
    else:
        b.walk(p1, p2, speed=pace)

    if not rushed:
        b.dwell(p2, 30)
    if scenario == "fraud_cp2":
        # Spoof attempt: sends checkpoint 2's QR from checkpoint 1's location.
        b.scan(cp2.id, p1)
    elif scenario == "inactivity_cp2":
        b.dwell(p2, 360, sensors=(0.35, 0.15, 0.05))  # six still minutes before scanning
        b.scan(cp2.id, p2)
    else:
        b.scan(cp2.id, p2)

    # Stretches 2 -> 3 -> 4
    if scenario == "detour_skip_cp3":
        # Wanders ~250 m outside the perimeter instead of passing checkpoint 3.
        mid = _lerp(p2, p3, 0.5)
        outside = (mid[0] + 250 / M_PER_DEG_LNG, mid[1])
        b.walk(p2, outside)
        b.dwell(outside, 45)
        b.walk(outside, p4)
    elif scenario == "fast_skip_cp3":
        # Covers the whole stretch at vehicle speed, skipping checkpoint 3.
        b.walk(p2, p3, speed=VEHICLE_SPEED_MPS)
        b.walk(p3, p4, speed=VEHICLE_SPEED_MPS)
    else:
        if scenario == "long_break":
            b.dwell(p2, LONG_BREAK_S)  # a quarter of an hour sitting at checkpoint 2
        b.walk(p2, p3, speed=pace)
        stop_and_scan(cp3, p3)
        if scenario == "phone_static":
            # GPS keeps moving while the phone lies still: location spoofing,
            # or the phone carried by something other than the guard.
            b.walk(p3, p4, sensors=SENSOR_STATIC)
        elif scenario == "gps_jump":
            b.walk(p3, p4, spike_at=0.5)
        else:
            b.walk(p3, p4, speed=pace)

    stop_and_scan(cp4, p4)
    b.walk(p4, p1, speed=pace)
    return b


def _create_session(
    db: Session,
    guard: User,
    route: Route,
    cps: list[tuple[Checkpoint, Coord]],
    start: datetime,
    scenario: str,
    rng: random.Random,
) -> PatrolSession:
    builder = _build(scenario, cps, start, rng)

    session = PatrolSession(
        guard_id=guard.id,
        route_id=route.id,
        device_id=DEMO_DEVICE,
        status=SessionStatus.completed,
        started_at=start,
        ended_at=builder.t + timedelta(seconds=20),
    )
    db.add(session)
    db.flush()

    db.add_all(
        TelemetryPoint(session_id=session.id, **point) for point in builder.points
    )
    db.commit()

    checkpoint_by_id = {cp.id: cp for cp, _ in cps}
    for checkpoint_id, (lng, lat), scanned_at in builder.scan_plan:
        process_scan(
            db,
            session=session,
            checkpoint=checkpoint_by_id[checkpoint_id],
            lat=lat,
            lng=lng,
            scanned_at=scanned_at,
        )

    analyze_session(db, session.id)
    return session


def _wipe_previous_demo(db: Session) -> int:
    demo_ids = select(PatrolSession.id).where(PatrolSession.device_id == DEMO_DEVICE)
    db.execute(delete(Anomaly).where(Anomaly.session_id.in_(demo_ids)))
    result = db.execute(
        delete(PatrolSession).where(PatrolSession.device_id == DEMO_DEVICE)
    )
    db.commit()
    return result.rowcount or 0


def _print_evaluation(db: Session, created: list[tuple[str, PatrolSession, User]]) -> None:
    """Expected vs. detected anomaly types per session (controlled evaluation)."""
    detected_by_session: dict[int, set[AnomalyType]] = {}
    for session_id, anomaly_type in db.execute(
        select(Anomaly.session_id, Anomaly.type).where(
            Anomaly.session_id.in_([session.id for _, session, _ in created])
        )
    ):
        detected_by_session.setdefault(session_id, set()).add(anomaly_type)

    tp = fp = fn = 0
    clean_ok = clean_total = 0
    print("\nEvaluation (expected vs. detected anomaly types):")
    print(f"  {'session':>7}  {'scenario':<16} {'result':<6} detail")
    for scenario, session, _ in created:
        expected = EXPECTED[scenario]
        detected = detected_by_session.get(session.id, set())
        hits, missing, extra = expected & detected, expected - detected, detected - expected
        tp, fn, fp = tp + len(hits), fn + len(missing), fp + len(extra)
        if scenario == "normal":
            clean_total += 1
            clean_ok += not detected
            if not detected:
                continue  # keep the table focused on what matters
        result = "OK" if not missing and not extra else "DIFF"
        detail = ", ".join(sorted(t.value for t in hits)) or "-"
        if missing:
            detail += f" | missing: {', '.join(sorted(t.value for t in missing))}"
        if extra:
            detail += f" | unexpected: {', '.join(sorted(t.value for t in extra))}"
        print(f"  {session.id:>7}  {scenario:<16} {result:<6} {detail}")

    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    print(f"\n  Normal sessions without anomalies: {clean_ok}/{clean_total}")
    print(f"  True positives: {tp}  False positives: {fp}  False negatives: {fn}")
    print(f"  Precision: {precision:.1%}  Recall: {recall:.1%}")


def main() -> None:
    rng = random.Random(42)
    db = SessionLocal()
    try:
        removed = _wipe_previous_demo(db)
        if removed:
            print(f"Removed {removed} previous demo sessions.")

        guards_by_email = {
            guard.email: guard
            for guard in db.scalars(select(User).where(User.email.in_(GUARD_EMAILS)))
        }
        guards = [guards_by_email[email] for email in GUARD_EMAILS if email in guards_by_email]
        route = db.scalar(select(Route).where(Route.is_active.is_(True)).order_by(Route.id))
        if len(guards) < 2 or route is None:
            raise SystemExit("Seeds missing: run `python -m app.seeds` first.")
        cps = _route_checkpoints(db, route)
        if len(cps) != 4:
            raise SystemExit("Expected the seeded route with 4 checkpoints.")

        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        created: list[tuple[str, PatrolSession, User]] = []
        for days_ago in range(DEMO_DAYS - 1, -1, -1):
            for guard_index, hour in ((0, 12), (1, 24)):  # 07:10 and 19:10 local (UTC-5)
                start = today - timedelta(days=days_ago) + timedelta(
                    hours=hour, minutes=10 + rng.randint(0, 25)
                )
                if start > datetime.now(timezone.utc) - timedelta(hours=1):
                    continue
                scenario = SPECIAL_SESSIONS.get((days_ago, guard_index), "normal")
                guard = guards[guard_index]
                session = _create_session(db, guard, route, cps, start, scenario, rng)
                created.append((scenario, session, guard))
                if scenario != "normal":
                    print(f"  - {scenario} session #{session.id} for {guard.full_name}")

        session_ids = [session.id for _, session, _ in created]
        valid, invalid = db.execute(
            select(
                func.count().filter(Scan.is_valid.is_(True)),
                func.count().filter(Scan.is_valid.is_(False)),
            ).where(Scan.session_id.in_(session_ids))
        ).one()
        anomalies = db.execute(
            select(Anomaly.type, func.count())
            .where(Anomaly.session_id.in_(session_ids))
            .group_by(Anomaly.type)
            .order_by(Anomaly.type)
        ).all()

        print(f"Created {len(created)} demo sessions over {DEMO_DAYS} days.")
        print(f"Scans: {valid} valid, {invalid} invalid.")
        for anomaly_type, count in anomalies:
            print(f"Anomalies {anomaly_type.value}: {count}")
        _print_evaluation(db, created)
    finally:
        db.close()


if __name__ == "__main__":
    main()
