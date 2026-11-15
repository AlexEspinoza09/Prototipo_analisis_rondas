"""Export labelled sensor windows as a training-ready CSV.

Run inside the api container:
    docker compose exec api python -m app.export_dataset --out /app/dataset.csv

One row per telemetry window that belongs to a session carrying an
`activity_label`. The train/test split is decided here, by session, on purpose:
windows from one session are near-duplicates of each other, so a random split by
row puts near-identical samples on both sides and inflates accuracy to a number
that says nothing. Splitting by session is the difference between a result that
survives questioning and one that does not.
"""

import argparse
import csv
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models import PatrolSession, TelemetryPoint

# Sensor features. Every one must be present for a row to be usable: a window
# too short for a spectrum yields NULLs, and imputing them would invent data.
FEATURE_COLUMNS = (
    "accel_magnitude",
    "accel_std",
    "accel_max",
    "accel_dominant_hz",
    "accel_peak_ratio",
    "gyro_magnitude",
    "gyro_std",
    "gyro_max",
    "gyro_dominant_hz",
    "gyro_peak_ratio",
    "sensor_sample_count",
)

# Kept out of FEATURE_COLUMNS: GPS-derived, and a row is still usable without it.
# See the warning printed by _summarise() before using it as a model input.
CONTEXT_COLUMNS = ("speed_mps", "accuracy_m")

METADATA_COLUMNS = ("session_id", "guard_id", "device_id", "recorded_at", "label", "split")


def _split_sessions(
    sessions_by_label: dict[str, list[int]], test_ratio: float, seed: int
) -> tuple[dict[int, str], list[str]]:
    """Assign whole sessions to train/test, stratified by label."""
    assignment: dict[int, str] = {}
    warnings: list[str] = []

    for label in sorted(sessions_by_label):
        session_ids = sorted(sessions_by_label[label])
        if len(session_ids) < 2:
            warnings.append(
                f"label '{label}' has only {len(session_ids)} session: everything goes to "
                f"train, so this class cannot be evaluated. Record at least 2 sessions."
            )
            assignment.update({sid: "train" for sid in session_ids})
            continue
        shuffled = session_ids[:]
        random.Random(f"{seed}:{label}").shuffle(shuffled)
        # At least one session per side once there are two or more.
        n_test = max(1, round(len(shuffled) * test_ratio))
        n_test = min(n_test, len(shuffled) - 1)
        for index, session_id in enumerate(shuffled):
            assignment[session_id] = "test" if index < n_test else "train"

    return assignment, warnings


def _summarise(
    rows: list[dict],
    dropped: int,
    sessions_by_label: dict[str, list[int]],
    warnings: list[str],
) -> None:
    per_group = Counter((row["label"], row["split"]) for row in rows)
    labels = sorted(sessions_by_label)

    print(f"\n{'label':<10} {'sessions':>9} {'train':>8} {'test':>8}")
    for label in labels:
        print(
            f"{label:<10} {len(sessions_by_label[label]):>9} "
            f"{per_group[(label, 'train')]:>8} {per_group[(label, 'test')]:>8}"
        )
    print(f"{'TOTAL':<10} {sum(len(v) for v in sessions_by_label.values()):>9} "
          f"{sum(c for (_, s), c in per_group.items() if s == 'train'):>8} "
          f"{sum(c for (_, s), c in per_group.items() if s == 'test'):>8}")

    if dropped:
        print(f"\nDropped {dropped} windows with incomplete sensor features.")

    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)

    if len(labels) < 2:
        print(
            "WARNING: fewer than 2 labelled classes; there is nothing to classify yet.",
            file=sys.stderr,
        )

    print(
        "\nNOTE: speed_mps comes from GPS, not the inertial sensors. Including it makes "
        "the 'vehicle' class trivially separable and weakens any claim that detection is "
        "sensor-based. Train without it first, then report what it adds.",
        file=sys.stderr,
    )


def export(db: Session, out_path: Path, test_ratio: float, seed: int) -> int:
    rows_query = (
        select(PatrolSession, TelemetryPoint)
        .join(TelemetryPoint, TelemetryPoint.session_id == PatrolSession.id)
        .where(PatrolSession.activity_label.isnot(None))
        .order_by(TelemetryPoint.session_id, TelemetryPoint.recorded_at)
    )

    sessions_by_label: dict[str, list[int]] = defaultdict(list)
    seen_sessions: set[int] = set()
    usable: list[tuple[PatrolSession, TelemetryPoint]] = []
    dropped = 0

    for session, point in db.execute(rows_query):
        if any(getattr(point, column) is None for column in FEATURE_COLUMNS):
            dropped += 1
            continue
        usable.append((session, point))
        if session.id not in seen_sessions:
            seen_sessions.add(session.id)
            sessions_by_label[session.activity_label.value].append(session.id)

    if not usable:
        print("No labelled windows with complete features found.", file=sys.stderr)
        print(
            "Record a session, then tag it: PATCH /sessions/{id}/label "
            '{"activity_label": "walking"}',
            file=sys.stderr,
        )
        return 0

    assignment, warnings = _split_sessions(sessions_by_label, test_ratio, seed)

    rows: list[dict] = []
    for session, point in usable:
        row = {
            "session_id": session.id,
            "guard_id": session.guard_id,
            "device_id": session.device_id,
            "recorded_at": point.recorded_at.isoformat(),
            "label": session.activity_label.value,
            "split": assignment[session.id],
        }
        row.update({column: getattr(point, column) for column in CONTEXT_COLUMNS})
        row.update({column: getattr(point, column) for column in FEATURE_COLUMNS})
        rows.append(row)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=[*METADATA_COLUMNS, *CONTEXT_COLUMNS, *FEATURE_COLUMNS]
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {out_path}")
    _summarise(rows, dropped, sessions_by_label, warnings)
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("dataset.csv"))
    parser.add_argument(
        "--test-ratio",
        type=float,
        default=0.25,
        help="Share of each label's sessions held out for testing (default: 0.25).",
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="Seed for the session shuffle (default: 42)."
    )
    args = parser.parse_args()

    if not 0 < args.test_ratio < 1:
        parser.error("--test-ratio must be between 0 and 1 (exclusive)")

    db = SessionLocal()
    try:
        export(db, args.out, args.test_ratio, args.seed)
    finally:
        db.close()


if __name__ == "__main__":
    main()
