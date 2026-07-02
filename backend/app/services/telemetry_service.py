from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import PatrolSession, TelemetryPoint
from app.schemas.telemetry import TelemetryPointIn


def ingest_batch(
    db: Session, session: PatrolSession, points: list[TelemetryPointIn]
) -> tuple[int, int]:
    """Bulk-insert telemetry points, silently skipping duplicates.

    Idempotency relies on the unique index (session_id, recorded_at), so mobile
    retries of the same batch are safe. Returns (inserted, duplicates).
    """
    values = [
        {
            "session_id": session.id,
            "recorded_at": point.recorded_at,
            "location": f"SRID=4326;POINT({point.lng} {point.lat})",
            "accuracy_m": point.accuracy_m,
            "speed_mps": point.speed_mps,
            "accel_magnitude": point.accel_magnitude,
            "is_moving": point.is_moving,
        }
        for point in points
    ]
    stmt = (
        insert(TelemetryPoint)
        .values(values)
        .on_conflict_do_nothing(index_elements=["session_id", "recorded_at"])
    )
    result = db.execute(stmt)
    db.commit()
    inserted = result.rowcount or 0
    return inserted, len(values) - inserted
