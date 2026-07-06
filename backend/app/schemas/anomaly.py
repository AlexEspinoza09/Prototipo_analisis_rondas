from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models import AnomalySeverity, AnomalyType


class AnomalyOut(BaseModel):
    id: int
    session_id: int | None
    guard_id: int
    guard_name: str
    type: AnomalyType
    severity: AnomalySeverity
    detected_at: datetime
    details: dict[str, Any]
    reviewed: bool


class AnomalyReviewIn(BaseModel):
    reviewed: bool = True
