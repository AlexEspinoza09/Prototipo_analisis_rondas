import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_roles
from app.models import Checkpoint, Scan, User, UserRole
from app.schemas.checkpoint import CheckpointIn, CheckpointOut, CheckpointUpdate

router = APIRouter(prefix="/checkpoints", tags=["checkpoints"])

_staff = require_roles(UserRole.admin, UserRole.supervisor)

_geom = cast(Checkpoint.location, Geometry())


def _to_out(checkpoint: Checkpoint, lng: float, lat: float) -> CheckpointOut:
    return CheckpointOut(
        id=checkpoint.id,
        site_id=checkpoint.site_id,
        name=checkpoint.name,
        qr_code=checkpoint.qr_code,
        lat=lat,
        lng=lng,
        radius_m=checkpoint.radius_m,
        is_active=checkpoint.is_active,
    )


def _get_one(db: Session, checkpoint_id: int) -> CheckpointOut:
    row = db.execute(
        select(Checkpoint, func.ST_X(_geom), func.ST_Y(_geom)).where(
            Checkpoint.id == checkpoint_id
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checkpoint not found")
    return _to_out(*row)


@router.get("", response_model=list[CheckpointOut])
def list_checkpoints(
    site_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CheckpointOut]:
    query = select(Checkpoint, func.ST_X(_geom), func.ST_Y(_geom)).order_by(Checkpoint.id)
    if site_id is not None:
        query = query.where(Checkpoint.site_id == site_id)
    return [_to_out(*row) for row in db.execute(query)]


@router.post("", response_model=CheckpointOut, status_code=status.HTTP_201_CREATED)
def create_checkpoint(
    payload: CheckpointIn, user: User = Depends(_staff), db: Session = Depends(get_db)
) -> CheckpointOut:
    checkpoint = Checkpoint(
        site_id=payload.site_id,
        name=payload.name,
        qr_code=uuid.uuid4(),
        location=f"SRID=4326;POINT({payload.lng} {payload.lat})",
        radius_m=payload.radius_m,
    )
    db.add(checkpoint)
    db.commit()
    return _get_one(db, checkpoint.id)


@router.patch("/{checkpoint_id}", response_model=CheckpointOut)
def update_checkpoint(
    checkpoint_id: int,
    payload: CheckpointUpdate,
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> CheckpointOut:
    checkpoint = db.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checkpoint not found")
    if (payload.lat is None) != (payload.lng is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="lat and lng must be provided together",
        )
    if payload.name is not None:
        checkpoint.name = payload.name
    if payload.radius_m is not None:
        checkpoint.radius_m = payload.radius_m
    if payload.is_active is not None:
        checkpoint.is_active = payload.is_active
    if payload.lat is not None and payload.lng is not None:
        checkpoint.location = f"SRID=4326;POINT({payload.lng} {payload.lat})"
    db.commit()
    return _get_one(db, checkpoint_id)


@router.delete("/{checkpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checkpoint(
    checkpoint_id: int, user: User = Depends(_staff), db: Session = Depends(get_db)
) -> None:
    checkpoint = db.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Checkpoint not found")
    has_scans = db.scalar(
        select(func.count()).select_from(Scan).where(Scan.checkpoint_id == checkpoint_id)
    )
    if has_scans:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Checkpoint has scans; deactivate it instead",
        )
    db.delete(checkpoint)
    db.commit()
