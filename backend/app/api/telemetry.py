from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models import PatrolSession, User, UserRole
from app.schemas.telemetry import TelemetryBatchIn, TelemetryBatchOut
from app.services.telemetry_service import ingest_batch

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


@router.post("/batch", response_model=TelemetryBatchOut)
def telemetry_batch(
    payload: TelemetryBatchIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelemetryBatchOut:
    """Hot path: bulk-ingest GPS/sensor points buffered by the mobile app.

    Idempotent — duplicates by (session_id, recorded_at) are ignored, so the
    app can retry batches safely. Points are accepted for ended sessions too,
    because the mobile buffer may sync late.
    """
    session = db.get(PatrolSession, payload.session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if user.role == UserRole.guard and session.guard_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Session belongs to another guard"
        )

    inserted, duplicates = ingest_batch(db, session, payload.points)
    return TelemetryBatchOut(
        received=len(payload.points), inserted=inserted, duplicates=duplicates
    )
