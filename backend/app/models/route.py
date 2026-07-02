from geoalchemy2 import Geography
from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    expected_path = mapped_column(Geography(geometry_type="LINESTRING", srid=4326), nullable=True)
    expected_duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        nullable=False, default=True, server_default=text("true")
    )

    checkpoints: Mapped[list["RouteCheckpoint"]] = relationship(
        back_populates="route", order_by="RouteCheckpoint.sequence_order"
    )


class RouteCheckpoint(Base):
    __tablename__ = "route_checkpoints"
    __table_args__ = (UniqueConstraint("route_id", "sequence_order"),)

    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True
    )
    checkpoint_id: Mapped[int] = mapped_column(
        ForeignKey("checkpoints.id", ondelete="CASCADE"), primary_key=True
    )
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_offset_min: Mapped[int] = mapped_column(Integer, nullable=False)

    route: Mapped["Route"] = relationship(back_populates="checkpoints")
    checkpoint: Mapped["Checkpoint"] = relationship()  # noqa: F821
