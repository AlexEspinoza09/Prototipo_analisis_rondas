from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_roles
from app.models import Site, User, UserRole
from app.schemas.site import SiteIn, SiteOut

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[SiteOut])
def list_sites(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[Site]:
    return list(db.scalars(select(Site).order_by(Site.name)))


@router.post("", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteIn,
    user: User = Depends(require_roles(UserRole.admin, UserRole.supervisor)),
    db: Session = Depends(get_db),
) -> Site:
    site = Site(name=payload.name, address=payload.address)
    db.add(site)
    db.commit()
    db.refresh(site)
    return site
