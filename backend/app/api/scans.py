from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models import Checkpoint, PatrolSession, SessionStatus, User, UserRole
from app.schemas.scan import ScanIn, ScanOut
from app.services.scan_service import process_scan

router = APIRouter(prefix="/scans", tags=["scans"])


@router.post("", response_model=ScanOut, status_code=status.HTTP_201_CREATED)
def create_scan(
    payload: ScanIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScanOut:
    """Register a QR scan and validate it inline (rules 1 and 2).

    Returns the validation verdict immediately so the app can give the guard
    clear visual feedback.
    """
    session = db.get(PatrolSession, payload.session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if user.role == UserRole.guard and session.guard_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Session belongs to another guard"
        )
    if session.status != SessionStatus.in_progress:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Session is not in progress"
        )

    checkpoint = db.scalar(
        select(Checkpoint).where(
            Checkpoint.qr_code == payload.qr_code, Checkpoint.is_active.is_(True)
        )
    )
    if checkpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown QR code")

    scan = process_scan(
        db,
        session=session,
        checkpoint=checkpoint,
        lat=payload.lat,
        lng=payload.lng,
        scanned_at=payload.scanned_at,
    )
    return ScanOut(
        id=scan.id,
        checkpoint_id=checkpoint.id,
        checkpoint_name=checkpoint.name,
        scanned_at=scan.scanned_at,
        is_valid=scan.is_valid,
        invalid_reason=scan.invalid_reason,
        distance_to_checkpoint_m=round(scan.distance_to_checkpoint_m, 1),
        radius_m=checkpoint.radius_m,
    )
