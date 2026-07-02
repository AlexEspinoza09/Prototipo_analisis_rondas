from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Identity, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TelemetryPoint(Base):
    """High-volume GPS/sensor points. Partitioned by month on recorded_at (see migration).

    The primary key includes recorded_at because PostgreSQL requires the
    partition key to be part of every unique constraint.
    """

    __tablename__ = "telemetry_points"
    __table_args__ = (
        Index("ux_telemetry_session_recorded", "session_id", "recorded_at", unique=True),
        {"postgresql_partition_by": "RANGE (recorded_at)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, nullable=False
    )
    session_id: Mapped[int] = mapped_column(
        ForeignKey("patrol_sessions.id", ondelete="CASCADE"), nullable=False
    )
    location = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False
    )
    accuracy_m: Mapped[float] = mapped_column(Float, nullable=False)
    speed_mps: Mapped[float | None] = mapped_column(Float)
    accel_magnitude: Mapped[float | None] = mapped_column(Float)
    is_moving: Mapped[bool | None] = mapped_column()
