from datetime import datetime, timedelta, timezone

from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, select
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
    Scan,
    ScanInvalidReason,
    TelemetryPoint,
)


def _fraud_severity(distance_m: float, radius_m: int) -> AnomalySeverity:
    ratio = distance_m / radius_m if radius_m else float("inf")
    if ratio >= settings.fraud_severity_high_ratio:
        return AnomalySeverity.high
    if ratio >= settings.fraud_severity_medium_ratio:
        return AnomalySeverity.medium
    return AnomalySeverity.low


def _window_displacement_m(db: Session, session_id: int, start: datetime, end: datetime) -> float:
    """Length in meters of the GPS track recorded between start and end."""
    length = db.scalar(
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
            )
        ).where(
            TelemetryPoint.session_id == session_id,
            TelemetryPoint.recorded_at >= start,
            TelemetryPoint.recorded_at <= end,
        )
    )
    return float(length or 0.0)


def _check_prior_inactivity(
    db: Session, session: PatrolSession, scanned_at: datetime
) -> dict | None:
    """Business rule 2: inspect telemetry from the window before the scan.

    Returns evidence dict when the guard shows no walking activity, or None when
    movement looks normal or there is no telemetry to judge (deferred analysis).

    On vehicle patrols a smooth ride reads as low acceleration, so the sensors
    only count as inactivity when the GPS track barely moved as well.
    """
    window_start = scanned_at - timedelta(minutes=settings.inactivity_window_min)
    rows = db.execute(
        select(TelemetryPoint.accel_magnitude, TelemetryPoint.is_moving).where(
            TelemetryPoint.session_id == session.id,
            TelemetryPoint.recorded_at >= window_start,
            TelemetryPoint.recorded_at <= scanned_at,
        )
    ).all()
    if not rows:
        return None

    accel_values = [r.accel_magnitude for r in rows if r.accel_magnitude is not None]
    moving_flags = [r.is_moving for r in rows if r.is_moving is not None]

    avg_accel = sum(accel_values) / len(accel_values) if accel_values else None
    still_ratio = (
        moving_flags.count(False) / len(moving_flags) if moving_flags else None
    )

    low_accel = avg_accel is not None and avg_accel < settings.walk_accel_threshold_mps2
    mostly_still = still_ratio is not None and still_ratio > settings.inactivity_still_ratio
    if not (low_accel or mostly_still):
        return None

    vehicle_evidence: dict = {}
    if session.route.patrol_mode == PatrolMode.vehicle:
        displacement_m = _window_displacement_m(db, session.id, window_start, scanned_at)
        if displacement_m >= settings.inactivity_vehicle_min_displacement_m:
            return None
        vehicle_evidence = {
            "displacement_m": round(displacement_m, 1),
            "min_displacement_m": settings.inactivity_vehicle_min_displacement_m,
        }

    return {
        "patrol_mode": session.route.patrol_mode.value,
        "window_min": settings.inactivity_window_min,
        "points_in_window": len(rows),
        "avg_accel_magnitude": round(avg_accel, 3) if avg_accel is not None else None,
        "still_ratio": round(still_ratio, 3) if still_ratio is not None else None,
        "walk_accel_threshold_mps2": settings.walk_accel_threshold_mps2,
        "inactivity_still_ratio": settings.inactivity_still_ratio,
        **vehicle_evidence,
    }


def process_scan(
    db: Session,
    session: PatrolSession,
    checkpoint: Checkpoint,
    lat: float,
    lng: float,
    scanned_at: datetime | None,
) -> Scan:
    """Validate and persist a QR scan (business rules 1 and 2), plus anomalies."""
    scanned_at = scanned_at or datetime.now(timezone.utc)
    scan_ewkt = f"SRID=4326;POINT({lng} {lat})"

    distance_m: float = db.scalar(
        select(func.ST_Distance(Checkpoint.location, func.ST_GeographyFromText(scan_ewkt))).where(
            Checkpoint.id == checkpoint.id
        )
    )

    scan = Scan(
        session_id=session.id,
        checkpoint_id=checkpoint.id,
        scanned_at=scanned_at,
        scan_location=scan_ewkt,
        distance_to_checkpoint_m=distance_m,
        is_valid=True,
    )

    is_duplicate = (
        db.scalar(
            select(func.count())
            .select_from(Scan)
            .where(Scan.session_id == session.id, Scan.checkpoint_id == checkpoint.id)
        )
        > 0
    )

    if is_duplicate:
        scan.is_valid = False
        scan.invalid_reason = ScanInvalidReason.duplicate
        db.add(scan)
    elif distance_m > checkpoint.radius_m:
        # Rule 1: scan happened outside the checkpoint validation radius.
        scan.is_valid = False
        scan.invalid_reason = ScanInvalidReason.out_of_range
        db.add(scan)
        db.flush()
        db.add(
            Anomaly(
                session_id=session.id,
                guard_id=session.guard_id,
                type=AnomalyType.fraudulent_scan,
                severity=_fraud_severity(distance_m, checkpoint.radius_m),
                detected_at=scanned_at,
                details={
                    "scan_id": scan.id,
                    "checkpoint_id": checkpoint.id,
                    "checkpoint_name": checkpoint.name,
                    "distance_m": round(distance_m, 1),
                    "radius_m": checkpoint.radius_m,
                },
            )
        )
    else:
        # Rule 2 only makes sense for scans that are otherwise in range.
        inactivity_evidence = _check_prior_inactivity(db, session, scanned_at)
        if inactivity_evidence is not None:
            scan.is_valid = False
            scan.invalid_reason = ScanInvalidReason.no_prior_movement
            db.add(scan)
            db.flush()
            db.add(
                Anomaly(
                    session_id=session.id,
                    guard_id=session.guard_id,
                    type=AnomalyType.inactivity,
                    severity=AnomalySeverity.medium,
                    detected_at=scanned_at,
                    details={
                        "scan_id": scan.id,
                        "checkpoint_id": checkpoint.id,
                        "checkpoint_name": checkpoint.name,
                        **inactivity_evidence,
                    },
                )
            )
        else:
            db.add(scan)

    db.commit()
    db.refresh(scan)
    return scan
