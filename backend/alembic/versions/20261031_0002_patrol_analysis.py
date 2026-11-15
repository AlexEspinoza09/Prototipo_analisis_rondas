"""patrol mode, extra sensor columns and new anomaly types

Revision ID: 0002_patrol_analysis
Revises: 0001_initial
Create Date: 2026-10-31

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_patrol_analysis"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_ANOMALY_TYPES = (
    "segment_too_fast",
    "segment_too_slow",
    "out_of_sequence",
    "missed_checkpoint",
    "round_too_short",
    "round_too_long",
    "sensor_mismatch",
    "telemetry_gap",
    "gps_jump",
)


def upgrade() -> None:
    patrol_mode = sa.Enum("foot", "vehicle", name="patrol_mode")
    patrol_mode.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "routes",
        sa.Column("patrol_mode", patrol_mode, nullable=False, server_default="foot"),
    )

    # Columns added to the partitioned parent propagate to every partition.
    op.add_column("telemetry_points", sa.Column("accel_std", sa.Float))
    op.add_column("telemetry_points", sa.Column("gyro_magnitude", sa.Float))

    for value in NEW_ANOMALY_TYPES:
        op.execute(f"ALTER TYPE anomaly_type ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL cannot drop enum values: rows using them are removed and the
    # values stay in the anomaly_type enum (harmless).
    values = ", ".join(f"'{value}'" for value in NEW_ANOMALY_TYPES)
    op.execute(f"DELETE FROM anomalies WHERE type::text IN ({values})")
    op.drop_column("telemetry_points", "gyro_magnitude")
    op.drop_column("telemetry_points", "accel_std")
    op.drop_column("routes", "patrol_mode")
    sa.Enum(name="patrol_mode").drop(op.get_bind(), checkfirst=True)
