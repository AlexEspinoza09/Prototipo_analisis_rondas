"""add per-window sensor features for activity recognition

Revision ID: 0003_sensor_features
Revises: 0002_gyro_magnitude
Create Date: 2026-08-06

The mean magnitude alone cannot separate walking from riding a vehicle — both
land on similar averages. What separates them is dispersion and rhythm: walking
has a periodic cadence around 1.5-2.5 Hz that a vehicle does not. These columns
store, per sensor window, the features a human-activity-recognition model needs,
computed on the phone (storing raw samples would mean ~576k rows per shift).

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_sensor_features"
down_revision: str | None = "0002_gyro_magnitude"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (name, type) — all nullable: windows before this migration, devices missing a
# sensor, and windows too short for a spectrum all legitimately carry NULL.
_FEATURE_COLUMNS: list[tuple[str, sa.types.TypeEngine]] = [
    # Dispersion and peak of the magnitude series.
    ("accel_std", sa.Float()),
    ("accel_max", sa.Float()),
    ("gyro_std", sa.Float()),
    ("gyro_max", sa.Float()),
    # Rhythm: dominant frequency in the 0.5-5 Hz band and how much of the band's
    # power sits on it (1.0 = perfectly periodic, ~0 = broadband noise).
    ("accel_dominant_hz", sa.Float()),
    ("accel_peak_ratio", sa.Float()),
    ("gyro_dominant_hz", sa.Float()),
    ("gyro_peak_ratio", sa.Float()),
]


def upgrade() -> None:
    for name, column_type in _FEATURE_COLUMNS:
        op.add_column("telemetry_points", sa.Column(name, column_type, nullable=True))
    # Samples actually collected in the window. Android throttles sensor delivery
    # per device, so the effective rate must be recorded, not assumed.
    op.add_column(
        "telemetry_points", sa.Column("sensor_sample_count", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("telemetry_points", "sensor_sample_count")
    for name, _ in reversed(_FEATURE_COLUMNS):
        op.drop_column("telemetry_points", name)
