"""Async analysis of finished patrols and guard performance.

Per session, when it ends (run together by analyze_session, idempotent):
  - rule 3: route deviation (Fréchet) and sustained impossible speed;
  - rule 5: timing between checkpoints, visit order, missed checkpoints and
    overall round duration;
  - rule 6: GPS track moving while the phone's sensors read "lying still";
  - rule 7: GPS signal quality (telemetry gaps and instantaneous jumps).
Nightly, per guard: rule 4, performance decline.

Called from Celery tasks; kept broker-free so tests can exercise the logic
directly against the database."""

from collections.abc import Callable
from dataclasses import dataclass, field
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
    Checkpoint,
    PatrolMode,
    PatrolSession,
    Route,
    RouteCheckpoint,
    Scan,
    ScanInvalidReason,
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

# Cap on how many individual events are listed in a single anomaly's evidence.
MAX_EVIDENCE_ITEMS = 20

SESSION_ANALYSIS_TYPES = (
    AnomalyType.route_deviation,
    AnomalyType.impossible_speed,
    AnomalyType.segment_too_fast,
    AnomalyType.segment_too_slow,
    AnomalyType.out_of_sequence,
    AnomalyType.missed_checkpoint,
    AnomalyType.round_too_short,
    AnomalyType.round_too_long,
    AnomalyType.sensor_mismatch,
    AnomalyType.telemetry_gap,
    AnomalyType.gps_jump,
)


def speed_limit_mps(mode: PatrolMode) -> float:
    if mode == PatrolMode.vehicle:
        return settings.impossible_speed_vehicle_mps
    return settings.impossible_speed_mps


# ---------------------------------------------------------------------------
# Track preparation: points, GPS spikes and cleaned segments
# ---------------------------------------------------------------------------


@dataclass
class _TrackPoint:
    recorded_at: datetime
    accuracy_m: float
    accel_std: float | None
    gyro_magnitude: float | None
    dist_prev_m: float | None
    dt_prev_s: float | None
    dist_next_m: float | None
    dt_next_s: float | None
    # Distance between the previous and the next point (skipping this one)
    dist_skip_m: float | None


@dataclass
class _Segment:
    started_at: datetime
    ended_at: datetime
    duration_s: float
    distance_m: float
    accuracy_m: float  # worst accuracy of both ends
    accel_std: float | None  # sensor window attached to the end point
    gyro_magnitude: float | None

    @property
    def speed_mps(self) -> float:
        return self.distance_m / self.duration_s


@dataclass
class _Track:
    points: list[_TrackPoint]
    spikes: list[_TrackPoint]
    segments: list[_Segment]  # between consecutive points, spikes removed


def _load_points(db: Session, session_id: int) -> list[_TrackPoint]:
    rows = db.execute(
        text(
            """
            SELECT recorded_at, accuracy_m, accel_std, gyro_magnitude,
                   ST_Distance(location, LAG(location) OVER w) AS dist_prev_m,
                   EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_prev_s,
                   ST_Distance(location, LEAD(location) OVER w) AS dist_next_m,
                   EXTRACT(EPOCH FROM (LEAD(recorded_at) OVER w - recorded_at)) AS dt_next_s,
                   ST_Distance(LAG(location) OVER w, LEAD(location) OVER w) AS dist_skip_m
            FROM telemetry_points
            WHERE session_id = :session_id
            WINDOW w AS (ORDER BY recorded_at)
            ORDER BY recorded_at
            """
        ),
        {"session_id": session_id},
    ).all()

    def opt(value: Any) -> float | None:
        return float(value) if value is not None else None

    return [
        _TrackPoint(
            recorded_at=row.recorded_at,
            accuracy_m=float(row.accuracy_m),
            accel_std=opt(row.accel_std),
            gyro_magnitude=opt(row.gyro_magnitude),
            dist_prev_m=opt(row.dist_prev_m),
            dt_prev_s=opt(row.dt_prev_s),
            dist_next_m=opt(row.dist_next_m),
            dt_next_s=opt(row.dt_next_s),
            dist_skip_m=opt(row.dist_skip_m),
        )
        for row in rows
    ]


def _is_spike(point: _TrackPoint, limit_mps: float) -> bool:
    """An isolated outlier: hops far away at an absurd speed and comes right back."""
    if (
        point.dist_prev_m is None
        or point.dt_prev_s is None
        or point.dist_next_m is None
        or point.dt_next_s is None
        or point.dt_prev_s <= 0
        or point.dt_next_s <= 0
    ):
        return False
    jump_speed = settings.gps_jump_speed_factor * limit_mps
    goes_out = (
        point.dist_prev_m >= settings.gps_jump_min_distance_m
        and point.dist_prev_m / point.dt_prev_s >= jump_speed
    )
    comes_back = (
        point.dist_next_m >= settings.gps_jump_min_distance_m
        and point.dist_next_m / point.dt_next_s >= jump_speed
    )
    skip_speed = (point.dist_skip_m or 0.0) / (point.dt_prev_s + point.dt_next_s)
    return goes_out and comes_back and skip_speed <= limit_mps


def _build_track(db: Session, session_id: int, limit_mps: float) -> _Track:
    points = _load_points(db, session_id)
    spike_flags = [_is_spike(point, limit_mps) for point in points]

    segments: list[_Segment] = []
    prev_idx: int | None = None
    for i, point in enumerate(points):
        if spike_flags[i]:
            continue
        if prev_idx is not None:
            previous = points[prev_idx]
            # Across a removed spike, use the spike's own "skip" distance.
            distance = point.dist_prev_m if prev_idx == i - 1 else points[i - 1].dist_skip_m
            duration = (point.recorded_at - previous.recorded_at).total_seconds()
            if distance is not None and duration > 0:
                segments.append(
                    _Segment(
                        started_at=previous.recorded_at,
                        ended_at=point.recorded_at,
                        duration_s=duration,
                        distance_m=distance,
                        accuracy_m=max(previous.accuracy_m, point.accuracy_m),
                        accel_std=point.accel_std,
                        gyro_magnitude=point.gyro_magnitude,
                    )
                )
        prev_idx = i

    spikes = [point for point, spike in zip(points, spike_flags) if spike]
    return _Track(points=points, spikes=spikes, segments=segments)


@dataclass
class _Run:
    started_at: datetime
    ended_at: datetime
    duration_s: float = 0.0
    distance_m: float = 0.0
    max_speed_mps: float = 0.0

    def extend(self, segment: _Segment) -> None:
        self.ended_at = segment.ended_at
        self.duration_s += segment.duration_s
        self.distance_m += segment.distance_m
        self.max_speed_mps = max(self.max_speed_mps, segment.speed_mps)


def _find_runs(
    segments: list[_Segment], predicate: Callable[[_Segment], bool], min_duration_s: float
) -> list[_Run]:
    """Maximal stretches of consecutive segments matching predicate, long enough."""
    runs: list[_Run] = []
    current: _Run | None = None

    def close() -> None:
        if current is not None and current.duration_s >= min_duration_s:
            runs.append(current)

    for segment in segments:
        if not predicate(segment):
            close()
            current = None
            continue
        if current is None or segment.started_at != current.ended_at:
            close()
            current = _Run(segment.started_at, segment.started_at)
        current.extend(segment)
    close()
    return runs


# ---------------------------------------------------------------------------
# Rule 3: route deviation + impossible speed
# ---------------------------------------------------------------------------


def _session_frechet_distance_m(
    db: Session, session: PatrolSession, exclude_times: list[datetime]
) -> float | None:
    """Fréchet distance in meters between the actual track (GPS spikes removed)
    and the expected path."""
    track_filter = [TelemetryPoint.session_id == session.id]
    if exclude_times:
        track_filter.append(TelemetryPoint.recorded_at.notin_(exclude_times))
    actual_line = (
        select(
            func.ST_MakeLine(
                aggregate_order_by(
                    cast(TelemetryPoint.location, Geometry()), TelemetryPoint.recorded_at
                )
            )
        )
        .where(*track_filter)
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


def _rule3_route(
    db: Session, session: PatrolSession, track: _Track, limit_mps: float, now: datetime
) -> tuple[list[Anomaly], list[_Run]]:
    anomalies: list[Anomaly] = []
    if len(track.points) - len(track.spikes) < 2:
        return anomalies, []

    frechet_m = _session_frechet_distance_m(
        db, session, [spike.recorded_at for spike in track.spikes]
    )
    if frechet_m is not None and frechet_m > settings.route_frechet_threshold_m:
        severity = (
            AnomalySeverity.high
            if frechet_m >= 2 * settings.route_frechet_threshold_m
            else AnomalySeverity.medium
        )
        anomalies.append(
            Anomaly(
                session_id=session.id,
                guard_id=session.guard_id,
                type=AnomalyType.route_deviation,
                severity=severity,
                detected_at=now,
                details={
                    "frechet_distance_m": round(frechet_m, 1),
                    "threshold_m": settings.route_frechet_threshold_m,
                    "route_id": session.route_id,
                    "point_count": len(track.points),
                    "gps_spikes_excluded": len(track.spikes),
                },
            )
        )

    speed_runs = _find_runs(
        track.segments,
        lambda segment: segment.speed_mps > limit_mps,
        settings.impossible_speed_min_duration_s,
    )
    for run in speed_runs:
        severity = (
            AnomalySeverity.high if run.max_speed_mps >= 2 * limit_mps else AnomalySeverity.medium
        )
        anomalies.append(
            Anomaly(
                session_id=session.id,
                guard_id=session.guard_id,
                type=AnomalyType.impossible_speed,
                severity=severity,
                detected_at=now,
                details={
                    "patrol_mode": session.route.patrol_mode.value,
                    "started_at": run.started_at.isoformat(),
                    "ended_at": run.ended_at.isoformat(),
                    "duration_s": round(run.duration_s, 1),
                    "max_speed_mps": round(run.max_speed_mps, 2),
                    "speed_limit_mps": limit_mps,
                    "min_duration_s": settings.impossible_speed_min_duration_s,
                },
            )
        )
    return anomalies, speed_runs


# ---------------------------------------------------------------------------
# Rule 5: checkpoint timing, order, missed checkpoints, round duration
# ---------------------------------------------------------------------------


@dataclass
class CheckpointVisit:
    checkpoint_id: int
    name: str
    sequence_order: int
    expected_offset_min: int
    # First scan made inside the checkpoint radius: proof of physical presence.
    visited_at: datetime | None
    actual_offset_min: float | None
    scan_status: str  # valid | invalid | missed
    out_of_range_attempts: int


@dataclass
class SegmentTiming:
    from_checkpoint_id: int
    from_name: str
    to_checkpoint_id: int
    to_name: str
    expected_min: float
    actual_min: float
    ratio: float | None
    verdict: str  # ok | fast | slow


@dataclass
class SessionTimeline:
    session_id: int
    patrol_mode: PatrolMode
    expected_duration_min: int
    actual_duration_min: float | None
    checkpoints: list[CheckpointVisit] = field(default_factory=list)
    segments: list[SegmentTiming] = field(default_factory=list)
    # Sequence orders in the order the checkpoints were actually visited
    visit_order: list[int] = field(default_factory=list)

    @property
    def out_of_sequence(self) -> bool:
        return self.visit_order != sorted(self.visit_order)


def _segment_verdict(expected_min: float, actual_min: float) -> tuple[float | None, str]:
    if expected_min <= 0:
        return None, "ok"
    ratio = actual_min / expected_min
    delta = actual_min - expected_min
    if ratio < settings.segment_fast_ratio and -delta >= settings.segment_min_delta_min:
        return ratio, "fast"
    if ratio > settings.segment_slow_ratio and delta >= settings.segment_min_delta_min:
        return ratio, "slow"
    return ratio, "ok"


def build_timeline(db: Session, session: PatrolSession) -> SessionTimeline:
    """Expected vs. actual timing of every checkpoint in the session's route."""
    route = session.route
    route_checkpoints = db.execute(
        select(RouteCheckpoint, Checkpoint.name)
        .join(Checkpoint, RouteCheckpoint.checkpoint_id == Checkpoint.id)
        .where(RouteCheckpoint.route_id == route.id)
        .order_by(RouteCheckpoint.sequence_order)
    ).all()
    scans = db.scalars(
        select(Scan).where(Scan.session_id == session.id).order_by(Scan.scanned_at)
    ).all()

    timeline = SessionTimeline(
        session_id=session.id,
        patrol_mode=route.patrol_mode,
        expected_duration_min=route.expected_duration_min,
        actual_duration_min=(
            (session.ended_at - session.started_at).total_seconds() / 60
            if session.ended_at
            else None
        ),
    )

    for rc, name in route_checkpoints:
        cp_scans = [scan for scan in scans if scan.checkpoint_id == rc.checkpoint_id]
        in_range = [
            scan for scan in cp_scans if scan.invalid_reason != ScanInvalidReason.out_of_range
        ]
        visited_at = in_range[0].scanned_at if in_range else None
        if any(scan.is_valid for scan in cp_scans):
            scan_status = "valid"
        elif cp_scans:
            scan_status = "invalid"
        else:
            scan_status = "missed"
        timeline.checkpoints.append(
            CheckpointVisit(
                checkpoint_id=rc.checkpoint_id,
                name=name,
                sequence_order=rc.sequence_order,
                expected_offset_min=rc.expected_offset_min,
                visited_at=visited_at,
                actual_offset_min=(
                    round((visited_at - session.started_at).total_seconds() / 60, 2)
                    if visited_at
                    else None
                ),
                scan_status=scan_status,
                out_of_range_attempts=len(cp_scans) - len(in_range),
            )
        )

    visited = [cp for cp in timeline.checkpoints if cp.visited_at is not None]
    by_time = sorted(visited, key=lambda cp: cp.visited_at or session.started_at)
    timeline.visit_order = [cp.sequence_order for cp in by_time]

    # Time each stretch between consecutive visited checkpoints (route order),
    # only when they were also visited one right after the other.
    for a, b in zip(visited, visited[1:]):
        if a.visited_at is None or b.visited_at is None:
            continue
        if by_time.index(b) != by_time.index(a) + 1:
            continue  # out of order, or another checkpoint was visited in between
        expected_min = float(b.expected_offset_min - a.expected_offset_min)
        actual_min = (b.visited_at - a.visited_at).total_seconds() / 60
        ratio, verdict = _segment_verdict(expected_min, actual_min)
        timeline.segments.append(
            SegmentTiming(
                from_checkpoint_id=a.checkpoint_id,
                from_name=a.name,
                to_checkpoint_id=b.checkpoint_id,
                to_name=b.name,
                expected_min=expected_min,
                actual_min=round(actual_min, 2),
                ratio=round(ratio, 3) if ratio is not None else None,
                verdict=verdict,
            )
        )
    return timeline


def _rule5_timing(
    session: PatrolSession, timeline: SessionTimeline, now: datetime
) -> list[Anomaly]:
    anomalies: list[Anomaly] = []

    def add(anomaly_type: AnomalyType, severity: AnomalySeverity, details: dict[str, Any]) -> None:
        anomalies.append(
            Anomaly(
                session_id=session.id,
                guard_id=session.guard_id,
                type=anomaly_type,
                severity=severity,
                detected_at=now,
                details=details,
            )
        )

    for segment in timeline.segments:
        if segment.verdict == "ok" or segment.ratio is None:
            continue
        evidence = {
            "from_checkpoint": segment.from_name,
            "to_checkpoint": segment.to_name,
            "expected_min": segment.expected_min,
            "actual_min": segment.actual_min,
            "ratio": segment.ratio,
        }
        if segment.verdict == "fast":
            add(
                AnomalyType.segment_too_fast,
                (
                    AnomalySeverity.high
                    if segment.ratio < settings.segment_fast_ratio / 2
                    else AnomalySeverity.medium
                ),
                {**evidence, "fast_ratio": settings.segment_fast_ratio},
            )
        else:
            add(
                AnomalyType.segment_too_slow,
                (
                    AnomalySeverity.medium
                    if segment.ratio > settings.segment_slow_ratio * 2
                    else AnomalySeverity.low
                ),
                {**evidence, "slow_ratio": settings.segment_slow_ratio},
            )

    if timeline.out_of_sequence:
        name_by_order = {cp.sequence_order: cp.name for cp in timeline.checkpoints}
        add(
            AnomalyType.out_of_sequence,
            AnomalySeverity.medium,
            {
                "expected_order": [name_by_order[o] for o in sorted(timeline.visit_order)],
                "actual_order": [name_by_order[o] for o in timeline.visit_order],
            },
        )

    missed = [cp for cp in timeline.checkpoints if cp.visited_at is None]
    if missed:
        total = len(timeline.checkpoints)
        add(
            AnomalyType.missed_checkpoint,
            AnomalySeverity.high if len(missed) * 2 >= total else AnomalySeverity.medium,
            {
                "missed": [
                    {
                        "checkpoint": cp.name,
                        "sequence_order": cp.sequence_order,
                        "out_of_range_attempts": cp.out_of_range_attempts,
                    }
                    for cp in missed
                ],
                "missed_count": len(missed),
                "route_checkpoints": total,
            },
        )

    if timeline.actual_duration_min is not None and timeline.expected_duration_min > 0:
        ratio = timeline.actual_duration_min / timeline.expected_duration_min
        evidence = {
            "expected_duration_min": timeline.expected_duration_min,
            "actual_duration_min": round(timeline.actual_duration_min, 1),
            "ratio": round(ratio, 3),
        }
        if ratio < settings.round_short_ratio:
            add(
                AnomalyType.round_too_short,
                (
                    AnomalySeverity.high
                    if ratio < settings.round_short_ratio / 2
                    else AnomalySeverity.medium
                ),
                {**evidence, "short_ratio": settings.round_short_ratio},
            )
        elif ratio > settings.round_long_ratio:
            add(
                AnomalyType.round_too_long,
                (
                    AnomalySeverity.medium
                    if ratio > settings.round_long_ratio * 2
                    else AnomalySeverity.low
                ),
                {**evidence, "long_ratio": settings.round_long_ratio},
            )
    return anomalies


# ---------------------------------------------------------------------------
# Rule 6: sensor coherence (GPS moves, phone lies still)
# ---------------------------------------------------------------------------


def _is_static_but_moving(segment: _Segment) -> bool:
    if segment.accel_std is None:
        return False  # no sensor window (screen off): cannot judge
    gyro_still = (
        segment.gyro_magnitude is None  # device without gyroscope
        or segment.gyro_magnitude < settings.static_gyro_rad_s
    )
    return (
        segment.accel_std < settings.static_accel_std_mps2
        and gyro_still
        and segment.speed_mps >= settings.sensor_mismatch_min_speed_mps
    )


def _rule6_sensors(session: PatrolSession, track: _Track, now: datetime) -> list[Anomaly]:
    runs = _find_runs(
        track.segments, _is_static_but_moving, settings.sensor_mismatch_min_duration_s
    )
    if not runs:
        return []
    total_s = sum(run.duration_s for run in runs)
    return [
        Anomaly(
            session_id=session.id,
            guard_id=session.guard_id,
            type=AnomalyType.sensor_mismatch,
            severity=(
                AnomalySeverity.high
                if total_s >= 3 * settings.sensor_mismatch_min_duration_s
                else AnomalySeverity.medium
            ),
            detected_at=now,
            details={
                "total_duration_s": round(total_s, 1),
                "gps_distance_m": round(sum(run.distance_m for run in runs), 1),
                "stretches": [
                    {
                        "started_at": run.started_at.isoformat(),
                        "ended_at": run.ended_at.isoformat(),
                        "duration_s": round(run.duration_s, 1),
                        "distance_m": round(run.distance_m, 1),
                    }
                    for run in runs[:MAX_EVIDENCE_ITEMS]
                ],
                "static_accel_std_mps2": settings.static_accel_std_mps2,
                "static_gyro_rad_s": settings.static_gyro_rad_s,
                "min_speed_mps": settings.sensor_mismatch_min_speed_mps,
                "min_duration_s": settings.sensor_mismatch_min_duration_s,
            },
        )
    ]


# ---------------------------------------------------------------------------
# Rule 7: GPS signal quality (gaps and jumps)
# ---------------------------------------------------------------------------


def _gaps(session: PatrolSession, track: _Track) -> list[tuple[datetime, datetime, float]]:
    """Periods without telemetry longer than the threshold, including the start
    and the end of the session."""
    if session.ended_at is None:
        return []
    marks = [session.started_at, *(p.recorded_at for p in track.points), session.ended_at]
    gaps = []
    for a, b in zip(marks, marks[1:]):
        seconds = (b - a).total_seconds()
        if seconds > settings.telemetry_gap_s:
            gaps.append((a, b, seconds))
    return gaps


def _rule7_gps_quality(
    session: PatrolSession,
    track: _Track,
    limit_mps: float,
    speed_runs: list[_Run],
    now: datetime,
) -> list[Anomaly]:
    anomalies: list[Anomaly] = []

    gaps = _gaps(session, track)
    if gaps and session.ended_at is not None:
        session_s = (session.ended_at - session.started_at).total_seconds() or 1.0
        gap_s = sum(seconds for _, _, seconds in gaps)
        gap_ratio = gap_s / session_s
        if gap_ratio >= 0.5:
            severity = AnomalySeverity.high
        elif gap_ratio >= 0.2:
            severity = AnomalySeverity.medium
        else:
            severity = AnomalySeverity.low
        anomalies.append(
            Anomaly(
                session_id=session.id,
                guard_id=session.guard_id,
                type=AnomalyType.telemetry_gap,
                severity=severity,
                detected_at=now,
                details={
                    "gap_count": len(gaps),
                    "total_gap_s": round(gap_s, 1),
                    "gap_ratio": round(gap_ratio, 3),
                    "gaps": [
                        {"from": a.isoformat(), "to": b.isoformat(), "duration_s": round(s, 1)}
                        for a, b, s in gaps[:MAX_EVIDENCE_ITEMS]
                    ],
                    "gap_threshold_s": settings.telemetry_gap_s,
                },
            )
        )

    # Jumps: isolated spikes (out and back), plus single fast hops that are not
    # part of a sustained run (those are impossible_speed instead).
    jump_speed = settings.gps_jump_speed_factor * limit_mps
    jumps: list[dict[str, Any]] = [
        {
            "at": spike.recorded_at.isoformat(),
            "kind": "spike",
            "distance_m": round(spike.dist_prev_m or 0.0, 1),
            "accuracy_m": round(spike.accuracy_m, 1),
        }
        for spike in track.spikes
    ]

    def in_speed_run(segment: _Segment) -> bool:
        return any(
            run.started_at <= segment.started_at and segment.ended_at <= run.ended_at
            for run in speed_runs
        )

    for segment in track.segments:
        if (
            segment.distance_m >= settings.gps_jump_min_distance_m
            and segment.speed_mps >= jump_speed
            and not in_speed_run(segment)
        ):
            jumps.append(
                {
                    "at": segment.ended_at.isoformat(),
                    "kind": "hop",
                    "distance_m": round(segment.distance_m, 1),
                    "accuracy_m": round(segment.accuracy_m, 1),
                }
            )

    if jumps:
        # A jump with a good-accuracy fix is suspicious (possible location
        # spoofing); with a poor fix it is most likely plain GPS noise.
        precise = [j for j in jumps if j["accuracy_m"] <= settings.scan_max_accuracy_m]
        anomalies.append(
            Anomaly(
                session_id=session.id,
                guard_id=session.guard_id,
                type=AnomalyType.gps_jump,
                severity=AnomalySeverity.high if precise else AnomalySeverity.low,
                detected_at=now,
                details={
                    "jump_count": len(jumps),
                    "precise_jump_count": len(precise),
                    "jumps": sorted(jumps, key=lambda j: j["at"])[:MAX_EVIDENCE_ITEMS],
                    "min_distance_m": settings.gps_jump_min_distance_m,
                    "jump_speed_mps": round(jump_speed, 2),
                    "max_accuracy_m": settings.scan_max_accuracy_m,
                },
            )
        )
    return anomalies


# ---------------------------------------------------------------------------
# Session analysis entry point (Celery task on session end)
# ---------------------------------------------------------------------------


def analyze_session(db: Session, session_id: int) -> list[Anomaly]:
    """Rules 3, 5, 6 and 7 for a finished session. Idempotent."""
    session = db.get(PatrolSession, session_id)
    if session is None:
        return []

    already_analyzed = db.scalar(
        select(func.count())
        .select_from(Anomaly)
        .where(Anomaly.session_id == session_id, Anomaly.type.in_(SESSION_ANALYSIS_TYPES))
    )
    if already_analyzed:
        return []

    now = datetime.now(timezone.utc)
    limit_mps = speed_limit_mps(session.route.patrol_mode)
    track = _build_track(db, session_id, limit_mps)

    route_anomalies, speed_runs = _rule3_route(db, session, track, limit_mps, now)
    anomalies = [
        *route_anomalies,
        *_rule5_timing(session, build_timeline(db, session), now),
        *_rule6_sensors(session, track, now),
        *_rule7_gps_quality(session, track, limit_mps, speed_runs, now),
    ]

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
