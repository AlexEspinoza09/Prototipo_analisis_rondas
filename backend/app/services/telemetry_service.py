from datetime import timedelta

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import PatrolSession, TelemetryPoint
from app.schemas.telemetry import TelemetryPointIn


# Every schema field maps 1:1 onto a telemetry_points column except lat/lng,
# which combine into the PostGIS `location`. Deriving the list here keeps new
# sensor features flowing through without touching this module.
_COLUMN_FIELDS = tuple(
    name for name in TelemetryPointIn.model_fields if name not in {"lat", "lng"}
)


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
            "location": f"SRID=4326;POINT({point.lng} {point.lat})",
            **{name: getattr(point, name) for name in _COLUMN_FIELDS},
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
