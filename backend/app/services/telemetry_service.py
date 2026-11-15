from datetime import timedelta

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import PatrolSession, TelemetryPoint
from app.schemas.telemetry import TelemetryPointIn


def ingest_batch(
    db: Session, session: PatrolSession, points: list[TelemetryPointIn]
) -> tuple[int, int, int]:
    """Bulk-insert telemetry points, silently skipping duplicates.

    Idempotency relies on the unique index (session_id, recorded_at), so mobile
    retries of the same batch are safe. Points recorded well before the session
    started are stale cached fixes and are dropped, so they cannot fake a
    telemetry gap. Returns (inserted, duplicates, ignored).
    """
    earliest = session.started_at - timedelta(seconds=settings.telemetry_max_before_start_s)
    fresh = [point for point in points if point.recorded_at >= earliest]
    ignored = len(points) - len(fresh)
    if not fresh:
        return 0, 0, ignored

    values = [
        {
            "session_id": session.id,
            "recorded_at": point.recorded_at,
            "location": f"SRID=4326;POINT({point.lng} {point.lat})",
            "accuracy_m": point.accuracy_m,
            "speed_mps": point.speed_mps,
            "accel_magnitude": point.accel_magnitude,
            "accel_std": point.accel_std,
            "gyro_magnitude": point.gyro_magnitude,
            "is_moving": point.is_moving,
        }
        for point in fresh
    ]
    stmt = (
        insert(TelemetryPoint)
        .values(values)
        .on_conflict_do_nothing(index_elements=["session_id", "recorded_at"])
    )
    result = db.execute(stmt)
    db.commit()
    inserted = result.rowcount or 0
    return inserted, len(values) - inserted, ignored
