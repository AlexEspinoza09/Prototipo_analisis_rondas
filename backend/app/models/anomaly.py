import enum
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AnomalyType(str, enum.Enum):
    fraudulent_scan = "fraudulent_scan"
    route_deviation = "route_deviation"
    impossible_speed = "impossible_speed"
    inactivity = "inactivity"
    performance_decline = "performance_decline"


class AnomalySeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Anomaly(Base):
    __tablename__ = "anomalies"
    __table_args__ = (
        Index("ix_anomalies_guard_detected", "guard_id", "detected_at"),
        Index("ix_anomalies_type", "type"),
        Index("ix_anomalies_reviewed", "reviewed"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("patrol_sessions.id", ondelete="SET NULL")
    )
    guard_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[AnomalyType] = mapped_column(
        Enum(AnomalyType, name="anomaly_type"), nullable=False
    )
    severity: Mapped[AnomalySeverity] = mapped_column(
        Enum(AnomalySeverity, name="anomaly_severity"), nullable=False
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reviewed: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default=text("false")
    )

    guard: Mapped["User"] = relationship()  # noqa: F821
    session: Mapped["PatrolSession | None"] = relationship()  # noqa: F821
