import enum
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import DateTime, Enum, Float, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ScanInvalidReason(str, enum.Enum):
    out_of_range = "out_of_range"
    no_prior_movement = "no_prior_movement"
    duplicate = "duplicate"


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("patrol_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    checkpoint_id: Mapped[int] = mapped_column(
        ForeignKey("checkpoints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    scan_location = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    distance_to_checkpoint_m: Mapped[float] = mapped_column(Float, nullable=False)
    is_valid: Mapped[bool] = mapped_column(nullable=False)
    invalid_reason: Mapped[ScanInvalidReason | None] = mapped_column(
        Enum(ScanInvalidReason, name="scan_invalid_reason")
    )

    session: Mapped["PatrolSession"] = relationship()  # noqa: F821
    checkpoint: Mapped["Checkpoint"] = relationship()  # noqa: F821
