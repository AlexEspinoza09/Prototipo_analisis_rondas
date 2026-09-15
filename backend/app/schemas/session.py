from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import ActivityLabel, SessionStatus


class SessionStartIn(BaseModel):
    route_id: int
    device_id: str = Field(min_length=1, max_length=120)


class SessionLabelIn(BaseModel):
    """Tag a finished session with the activity it was recorded for.

    Nullable so a session mislabelled during collection can be cleared instead
    of silently poisoning the training set.
    """

    activity_label: ActivityLabel | None = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guard_id: int
    route_id: int
    started_at: datetime
    ended_at: datetime | None
    status: SessionStatus
    device_id: str
    activity_label: ActivityLabel | None = None


class SessionListOut(SessionOut):
    guard_name: str
    route_name: str
    scans_valid: int
    scans_invalid: int
