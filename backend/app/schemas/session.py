from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import SessionStatus


class SessionStartIn(BaseModel):
    route_id: int
    device_id: str = Field(min_length=1, max_length=120)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guard_id: int
    route_id: int
    started_at: datetime
    ended_at: datetime | None
    status: SessionStatus
    device_id: str
