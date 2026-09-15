"""add activity_label to patrol_sessions

Revision ID: 0004_activity_label
Revises: 0003_sensor_features
Create Date: 2026-08-07

Ground truth for supervised activity recognition. Only sessions recorded on
purpose to build the dataset carry a label; real patrols stay NULL, which is
what keeps training data and production data separable in the same table.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_activity_label"
down_revision: str | None = "0003_sensor_features"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIVITY_LABELS = ("walking", "still", "vehicle", "shaking")


def upgrade() -> None:
    activity_label = sa.Enum(*ACTIVITY_LABELS, name="activity_label")
    activity_label.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "patrol_sessions",
        sa.Column("activity_label", activity_label, nullable=True),
    )
    # Dataset export filters on this column, and labelled sessions are a small
    # fraction of the table.
    op.create_index(
        "ix_patrol_sessions_activity_label",
        "patrol_sessions",
        ["activity_label"],
        postgresql_where=sa.text("activity_label IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_patrol_sessions_activity_label", table_name="patrol_sessions")
    op.drop_column("patrol_sessions", "activity_label")
    sa.Enum(name="activity_label").drop(op.get_bind(), checkfirst=True)
