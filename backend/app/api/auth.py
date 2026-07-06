from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import (
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenPairOut
from app.schemas.user import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

_invalid_credentials = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
)


def _token_pair(user: User) -> TokenPairOut:
    return TokenPairOut(
        access_token=create_access_token(user.id, user.role.value),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/login", response_model=TokenPairOut)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenPairOut:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.is_active:
        raise _invalid_credentials
    if not verify_password(payload.password, user.hashed_password):
        raise _invalid_credentials
    return _token_pair(user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/refresh", response_model=TokenPairOut)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenPairOut:
    try:
        data = decode_token(payload.refresh_token)
        user_id = int(data["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise _invalid_credentials from exc
    if data.get("type") != REFRESH_TOKEN_TYPE:
        raise _invalid_credentials
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _invalid_credentials
    return _token_pair(user)
