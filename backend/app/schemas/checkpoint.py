from uuid import UUID

from pydantic import BaseModel, Field


class CheckpointIn(BaseModel):
    site_id: int
    name: str = Field(min_length=1, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius_m: int = Field(default=30, ge=5, le=1000)


class CheckpointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int | None = Field(default=None, ge=5, le=1000)
    is_active: bool | None = None


class CheckpointOut(BaseModel):
    id: int
    site_id: int
    name: str
    qr_code: UUID
    lat: float
    lng: float
    radius_m: int
    is_active: bool
