import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SessionStatus(str, enum.Enum):
    in_progress = "in_progress"
    completed = "completed"
    abandoned = "abandoned"


class ActivityLabel(str, enum.Enum):
    """Ground truth for a labelled collection session (training data only).

    Normal patrol sessions leave this NULL; only rounds recorded on purpose to
    build the activity-recognition dataset carry a label.
    """

    walking = "walking"
    still = "still"
    vehicle = "vehicle"
    # Phone shaken by hand to fake movement: the fraud a mean-based threshold
    # cannot tell apart from walking.
    shaking = "shaking"


class PatrolSession(Base):
    __tablename__ = "patrol_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    guard_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, name="session_status"),
        nullable=False,
        default=SessionStatus.in_progress,
    )
    device_id: Mapped[str] = mapped_column(String(120), nullable=False)
    activity_label: Mapped[ActivityLabel | None] = mapped_column(
        Enum(ActivityLabel, name="activity_label")
    )

    guard: Mapped["User"] = relationship()  # noqa: F821
    route: Mapped["Route"] = relationship()  # noqa: F821
