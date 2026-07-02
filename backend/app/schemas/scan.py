from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field

from app.models import ScanInvalidReason


class ScanIn(BaseModel):
    session_id: int
    qr_code: UUID
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    scanned_at: AwareDatetime | None = None


class ScanOut(BaseModel):
    id: int
    checkpoint_id: int
    checkpoint_name: str
    scanned_at: datetime
    is_valid: bool
    invalid_reason: ScanInvalidReason | None
    distance_to_checkpoint_m: float
    radius_m: int
