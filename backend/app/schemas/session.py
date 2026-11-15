from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import ActivityLabel, PatrolMode, SessionStatus


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


class TimelineCheckpointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    checkpoint_id: int
    name: str
    sequence_order: int
    expected_offset_min: int
    visited_at: datetime | None
    actual_offset_min: float | None
    scan_status: str


class TimelineSegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_checkpoint_id: int
    from_name: str
    to_checkpoint_id: int
    to_name: str
    expected_min: float
    actual_min: float
    ratio: float | None
    verdict: str


class SessionTimelineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    session_id: int
    patrol_mode: PatrolMode
    expected_duration_min: int
    actual_duration_min: float | None
    out_of_sequence: bool
    checkpoints: list[TimelineCheckpointOut]
    segments: list[TimelineSegmentOut]
