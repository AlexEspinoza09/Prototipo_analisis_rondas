"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-12

"""
from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# How many monthly partitions to create ahead of time for telemetry_points.
TELEMETRY_PARTITION_MONTHS = 12


def _month_range(start: date, count: int) -> list[tuple[date, date]]:
    """Return [(first_day, first_day_of_next_month), ...] for `count` months."""
    bounds = []
    year, month = start.year, start.month
    for _ in range(count):
        first = date(year, month, 1)
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
        bounds.append((first, date(year, month, 1)))
    return bounds


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "supervisor", "guard", name="user_role"),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "sites",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("address", sa.String(255)),
        sa.Column(
            "boundary",
            Geography(geometry_type="POLYGON", srid=4326, spatial_index=False),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_sites_boundary", "sites", ["boundary"], postgresql_using="gist"
    )

    op.create_table(
        "checkpoints",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "site_id",
            sa.Integer,
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("qr_code", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column(
            "location",
            Geography(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("radius_m", sa.Integer, nullable=False, server_default=sa.text("30")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )
    op.create_index(
        "ix_checkpoints_location", "checkpoints", ["location"], postgresql_using="gist"
    )

    op.create_table(
        "routes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "site_id",
            sa.Integer,
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column(
            "expected_path",
            Geography(geometry_type="LINESTRING", srid=4326, spatial_index=False),
            nullable=True,
        ),
        sa.Column("expected_duration_min", sa.Integer, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )
    op.create_index(
        "ix_routes_expected_path", "routes", ["expected_path"], postgresql_using="gist"
    )

    op.create_table(
        "route_checkpoints",
        sa.Column(
            "route_id",
            sa.Integer,
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "checkpoint_id",
            sa.Integer,
            sa.ForeignKey("checkpoints.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("sequence_order", sa.Integer, nullable=False),
        sa.Column("expected_offset_min", sa.Integer, nullable=False),
        sa.UniqueConstraint("route_id", "sequence_order"),
    )

    op.create_table(
        "patrol_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "guard_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "route_id",
            sa.Integer,
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column(
            "status",
            sa.Enum("in_progress", "completed", "abandoned", name="session_status"),
            nullable=False,
            server_default="in_progress",
        ),
        sa.Column("device_id", sa.String(120), nullable=False),
    )

    # Partitioned by month: high-volume table, monthly partitions keep indexes
    # small and let old data be dropped by detaching partitions.
    op.create_table(
        "telemetry_points",
        sa.Column("id", sa.BigInteger, sa.Identity(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("patrol_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "location",
            Geography(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("accuracy_m", sa.Float, nullable=False),
        sa.Column("speed_mps", sa.Float),
        sa.Column("accel_magnitude", sa.Float),
        sa.Column("is_moving", sa.Boolean),
        sa.PrimaryKeyConstraint("id", "recorded_at"),
        postgresql_partition_by="RANGE (recorded_at)",
    )
    # Unique on (session_id, recorded_at): doubles as the dedup key for the
    # idempotent batch-ingest endpoint and as the hot query index.
    op.create_index(
        "ux_telemetry_session_recorded",
        "telemetry_points",
        ["session_id", "recorded_at"],
        unique=True,
    )
    op.create_index(
        "ix_telemetry_points_location",
        "telemetry_points",
        ["location"],
        postgresql_using="gist",
    )

    first_month = date.today().replace(day=1)
    for start, end in _month_range(first_month, TELEMETRY_PARTITION_MONTHS):
        op.execute(
            f"CREATE TABLE telemetry_points_y{start.year}m{start.month:02d} "
            f"PARTITION OF telemetry_points "
            f"FOR VALUES FROM ('{start.isoformat()}') TO ('{end.isoformat()}')"
        )
    # Catch-all so inserts outside the pre-created range never fail.
    op.execute("CREATE TABLE telemetry_points_default PARTITION OF telemetry_points DEFAULT")

    op.create_table(
        "scans",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("patrol_sessions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "checkpoint_id",
            sa.Integer,
            sa.ForeignKey("checkpoints.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "scanned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "scan_location",
            Geography(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("distance_to_checkpoint_m", sa.Float, nullable=False),
        sa.Column("is_valid", sa.Boolean, nullable=False),
        sa.Column(
            "invalid_reason",
            sa.Enum(
                "out_of_range", "no_prior_movement", "duplicate", name="scan_invalid_reason"
            ),
        ),
    )
    op.create_index(
        "ix_scans_scan_location", "scans", ["scan_location"], postgresql_using="gist"
    )

    op.create_table(
        "anomalies",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("patrol_sessions.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "guard_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "type",
            sa.Enum(
                "fraudulent_scan",
                "route_deviation",
                "impossible_speed",
                "inactivity",
                "performance_decline",
                name="anomaly_type",
            ),
            nullable=False,
        ),
        sa.Column(
            "severity",
            sa.Enum("low", "medium", "high", name="anomaly_severity"),
            nullable=False,
        ),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("details", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("reviewed", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_anomalies_guard_detected", "anomalies", ["guard_id", "detected_at"])
    op.create_index("ix_anomalies_type", "anomalies", ["type"])
    op.create_index("ix_anomalies_reviewed", "anomalies", ["reviewed"])


def downgrade() -> None:
    op.drop_table("anomalies")
    op.drop_table("scans")
    op.drop_table("telemetry_points")  # drops its partitions too
    op.drop_table("patrol_sessions")
    op.drop_table("route_checkpoints")
    op.drop_table("routes")
    op.drop_table("checkpoints")
    op.drop_table("sites")
    op.drop_table("users")

    bind = op.get_bind()
    for enum_name in (
        "user_role",
        "session_status",
        "scan_invalid_reason",
        "anomaly_type",
        "anomaly_severity",
    ):
        sa.Enum(name=enum_name).drop(bind, checkfirst=True)
