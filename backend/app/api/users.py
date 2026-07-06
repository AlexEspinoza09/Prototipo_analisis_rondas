from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_roles
from app.core.security import hash_password
from app.models import PatrolSession, User, UserRole
from app.schemas.user import UserIn, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

_staff = require_roles(UserRole.admin, UserRole.supervisor)


@router.get("", response_model=list[UserOut])
def list_users(
    role: UserRole | None = None,
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> list[User]:
    query = select(User).order_by(User.full_name)
    if role is not None:
        query = query.where(User.role == role)
    return list(db.scalars(query))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserIn, user: User = Depends(_staff), db: Session = Depends(get_db)
) -> User:
    exists = db.scalar(select(func.count()).select_from(User).where(User.email == payload.email))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
    new_user = User(
        full_name=payload.full_name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if payload.full_name is not None:
        target.full_name = payload.full_name
    if payload.password is not None:
        target.hashed_password = hash_password(payload.password)
    if payload.role is not None:
        target.role = payload.role
    if payload.is_active is not None:
        target.is_active = payload.is_active
    db.commit()
    db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int, user: User = Depends(_staff), db: Session = Depends(get_db)
) -> None:
    if user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Cannot delete your own account"
        )
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    has_sessions = db.scalar(
        select(func.count()).select_from(PatrolSession).where(PatrolSession.guard_id == user_id)
    )
    if has_sessions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User has patrol sessions; deactivate instead",
        )
    db.delete(target)
    db.commit()
