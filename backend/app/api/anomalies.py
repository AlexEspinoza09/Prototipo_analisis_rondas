from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_roles
from app.models import Anomaly, AnomalySeverity, AnomalyType, User, UserRole
from app.schemas.anomaly import AnomalyOut, AnomalyReviewIn

router = APIRouter(prefix="/anomalies", tags=["anomalies"])

_staff = require_roles(UserRole.admin, UserRole.supervisor)


def _to_out(anomaly: Anomaly, guard_name: str) -> AnomalyOut:
    return AnomalyOut(
        id=anomaly.id,
        session_id=anomaly.session_id,
        guard_id=anomaly.guard_id,
        guard_name=guard_name,
        type=anomaly.type,
        severity=anomaly.severity,
        detected_at=anomaly.detected_at,
        details=anomaly.details,
        reviewed=anomaly.reviewed,
    )


@router.get("", response_model=list[AnomalyOut])
def list_anomalies(
    guard_id: int | None = None,
    anomaly_type: AnomalyType | None = Query(default=None, alias="type"),
    severity: AnomalySeverity | None = None,
    reviewed: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> list[AnomalyOut]:
    query = (
        select(Anomaly, User.full_name)
        .join(User, Anomaly.guard_id == User.id)
        .order_by(Anomaly.detected_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if guard_id is not None:
        query = query.where(Anomaly.guard_id == guard_id)
    if anomaly_type is not None:
        query = query.where(Anomaly.type == anomaly_type)
    if severity is not None:
        query = query.where(Anomaly.severity == severity)
    if reviewed is not None:
        query = query.where(Anomaly.reviewed.is_(reviewed))
    if date_from is not None:
        query = query.where(Anomaly.detected_at >= date_from)
    if date_to is not None:
        query = query.where(Anomaly.detected_at <= date_to)

    return [_to_out(anomaly, guard_name) for anomaly, guard_name in db.execute(query)]


@router.patch("/{anomaly_id}", response_model=AnomalyOut)
def review_anomaly(
    anomaly_id: int,
    payload: AnomalyReviewIn,
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> AnomalyOut:
    anomaly = db.get(Anomaly, anomaly_id)
    if anomaly is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anomaly not found")
    anomaly.reviewed = payload.reviewed
    db.commit()
    guard_name = db.scalar(select(User.full_name).where(User.id == anomaly.guard_id)) or ""
    return _to_out(anomaly, guard_name)
