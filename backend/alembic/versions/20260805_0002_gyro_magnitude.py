"""add gyro_magnitude to telemetry_points

Revision ID: 0002_gyro_magnitude
Revises: 0001_initial
Create Date: 2026-08-05

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_gyro_magnitude"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Mean angular speed (rad/s) over the sensor window, complementing
    # accel_magnitude. Nullable: points captured before this migration — and any
    # window where the gyroscope is unavailable — carry NULL.
    # Postgres propagates ADD COLUMN to every partition of telemetry_points.
    op.add_column("telemetry_points", sa.Column("gyro_magnitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("telemetry_points", "gyro_magnitude")
