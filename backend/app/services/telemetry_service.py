from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

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
) -> tuple[int, int]:
    """Bulk-insert telemetry points, silently skipping duplicates.

    Idempotency relies on the unique index (session_id, recorded_at), so mobile
    retries of the same batch are safe. Returns (inserted, duplicates).
    """
    values = [
        {
            "session_id": session.id,
            "location": f"SRID=4326;POINT({point.lng} {point.lat})",
            **{name: getattr(point, name) for name in _COLUMN_FIELDS},
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
