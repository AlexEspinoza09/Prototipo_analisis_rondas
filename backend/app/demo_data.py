"""Synthetic demo patrols for dashboard exploration.

Generates ~10 days of realistic patrol sessions over the seeded route in Quito:
walking pace with GPS jitter, dwell at each checkpoint, real scans through the
scan service (so rules 1 and 2 run authentically) and route analysis (rule 3)
executed synchronously. A few sessions tell a story: a route detour, a spoofed
scan, prior inactivity and an impossibly fast stretch.

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
    Checkpoint,
    PatrolSession,
    Route,
    RouteCheckpoint,
    Scan,
    SessionStatus,
    TelemetryPoint,
    User,
)
from app.services.analysis_service import analyze_session_route
from app.services.scan_service import process_scan

DEMO_DEVICE = "demo-data"
DEMO_DAYS = 10
WALK_SPEED_MPS = 1.3
POINT_INTERVAL_S = 15

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LNG = 111_320.0  # near the equator

Coord = tuple[float, float]  # (lng, lat)


def _meters(a: Coord, b: Coord) -> float:
    dx = (b[0] - a[0]) * M_PER_DEG_LNG
    dy = (b[1] - a[1]) * M_PER_DEG_LAT
    return math.hypot(dx, dy)


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

    def _add_point(
        self, pos: Coord, *, speed: float, accel: float, moving: bool
    ) -> None:
        lng, lat = _jitter(pos, self.rng)
        self.points.append(
            {
                "recorded_at": self.t,
                "location": f"SRID=4326;POINT({lng} {lat})",
                "accuracy_m": self.rng.uniform(5, 12),
                "speed_mps": max(0.0, speed + self.rng.gauss(0, 0.15)),
                "accel_magnitude": max(0.15, accel),
                # Angular speed (rad/s): a phone in a walking guard's pocket
                # swings noticeably; standing still it barely rotates.
                "gyro_magnitude": max(
                    0.0,
                    self.rng.gauss(1.4, 0.3) if moving else self.rng.gauss(0.05, 0.02),
                ),
                "is_moving": moving,
            }
        )

    def walk(self, start: Coord, end: Coord, speed: float = WALK_SPEED_MPS) -> None:
        distance = _meters(start, end)
        duration = distance / speed
        steps = max(1, round(duration / POINT_INTERVAL_S))
        for i in range(1, steps + 1):
            f = i / steps
            pos = (start[0] + (end[0] - start[0]) * f, start[1] + (end[1] - start[1]) * f)
            self.t += timedelta(seconds=POINT_INTERVAL_S)
            self._add_point(pos, speed=speed, accel=self.rng.gauss(2.2, 0.35), moving=True)

    def dwell(self, pos: Coord, seconds: int, *, accel: float = 0.5) -> None:
        for _ in range(max(1, seconds // POINT_INTERVAL_S)):
            self.t += timedelta(seconds=POINT_INTERVAL_S)
            self._add_point(pos, speed=0.0, accel=self.rng.gauss(accel, 0.08), moving=False)

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

    # Approach walk so rule 2 sees movement before the first scan. Kept under
    # the 100 m Frechet threshold so it does not read as a route deviation.
    approach = (p1[0], p1[1] - 80 / M_PER_DEG_LAT)
    b.walk(approach, p1)
    b.dwell(p1, 30)
    b.scan(cp1.id, p1)

    b.walk(p1, p2)
    b.dwell(p2, 30)
    if scenario == "fraud_cp2":
        # Spoof attempt: sends checkpoint 2's QR from checkpoint 1's location.
        b.scan(cp2.id, p1)
    elif scenario == "inactivity_cp2":
        b.dwell(p2, 360, accel=0.35)  # six still minutes before scanning
        b.scan(cp2.id, p2)
    else:
        b.scan(cp2.id, p2)

    if scenario == "detour_skip_cp3":
        # Wanders ~250 m east instead of passing checkpoint 3.
        mid = ((p2[0] + p4[0]) / 2 + 250 / M_PER_DEG_LNG, (p2[1] + p4[1]) / 2)
        b.walk(p2, mid)
        b.dwell(mid, 45)
        b.walk(mid, p4)
    elif scenario == "fast_skip_cp3":
        # Covers the whole stretch at vehicle speed, skipping checkpoint 3.
        b.walk(p2, p3, speed=8.0)
        b.walk(p3, p4, speed=8.0)
    else:
        b.walk(p2, p3)
        b.dwell(p3, 30)
        b.scan(cp3.id, p3)
        b.walk(p3, p4)

    b.dwell(p4, 30)
    b.scan(cp4.id, p4)
    b.walk(p4, p1)
    return b


def _create_session(
    db: Session,
    guard: User,
    route: Route,
    cps: list[tuple[Checkpoint, Coord]],
    start: datetime,
    scenario: str,
    rng: random.Random,
) -> tuple[int, int]:
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

    valid = invalid = 0
    checkpoint_by_id = {cp.id: cp for cp, _ in cps}
    for checkpoint_id, (lng, lat), scanned_at in builder.scan_plan:
        scan = process_scan(
            db,
            session=session,
            checkpoint=checkpoint_by_id[checkpoint_id],
            lat=lat,
            lng=lng,
            scanned_at=scanned_at,
        )
        if scan.is_valid:
            valid += 1
        else:
            invalid += 1

    analyze_session_route(db, session.id)
    return valid, invalid


def _wipe_previous_demo(db: Session) -> int:
    demo_ids = select(PatrolSession.id).where(PatrolSession.device_id == DEMO_DEVICE)
    db.execute(delete(Anomaly).where(Anomaly.session_id.in_(demo_ids)))
    result = db.execute(
        delete(PatrolSession).where(PatrolSession.device_id == DEMO_DEVICE)
    )
    db.commit()
    return result.rowcount or 0


def main() -> None:
    rng = random.Random(42)
    db = SessionLocal()
    try:
        removed = _wipe_previous_demo(db)
        if removed:
            print(f"Removed {removed} previous demo sessions.")

        guards = db.scalars(
            select(User).where(User.email.in_(["guardia1@protemaxi.ec", "guardia2@protemaxi.ec"]))
        ).all()
        route = db.scalar(select(Route).where(Route.is_active.is_(True)).order_by(Route.id))
        if len(guards) < 2 or route is None:
            raise SystemExit("Seeds missing: run `python -m app.seeds` first.")
        cps = _route_checkpoints(db, route)
        if len(cps) != 4:
            raise SystemExit("Expected the seeded route with 4 checkpoints.")

        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        special = {
            (3, 1): "detour_skip_cp3",   # guardia2, 3 days ago
            (2, 0): "fraud_cp2",         # guardia1, 2 days ago
            (1, 1): "inactivity_cp2",    # guardia2, yesterday
            (4, 0): "fast_skip_cp3",     # guardia1, 4 days ago
        }

        sessions = valid_total = invalid_total = 0
        for days_ago in range(DEMO_DAYS - 1, -1, -1):
            for guard_index, hour in ((0, 12), (1, 24)):  # 07:10 and 19:10 local (UTC-5)
                start = today - timedelta(days=days_ago) + timedelta(
                    hours=hour, minutes=10 + rng.randint(0, 25)
                )
                if start > datetime.now(timezone.utc) - timedelta(hours=1):
                    continue
                scenario = special.get((days_ago, guard_index), "normal")
                valid, invalid = _create_session(
                    db, guards[guard_index], route, cps, start, scenario, rng
                )
                sessions += 1
                valid_total += valid
                invalid_total += invalid
                if scenario != "normal":
                    print(f"  - {scenario} session for {guards[guard_index].full_name}")

        anomalies = db.execute(
            select(Anomaly.type, func.count())
            .join(PatrolSession, Anomaly.session_id == PatrolSession.id)
            .where(PatrolSession.device_id == DEMO_DEVICE)
            .group_by(Anomaly.type)
        ).all()

        print(f"Created {sessions} demo sessions over {DEMO_DAYS} days.")
        print(f"Scans: {valid_total} valid, {invalid_total} invalid.")
        for anomaly_type, count in anomalies:
            print(f"Anomalies {anomaly_type.value}: {count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
