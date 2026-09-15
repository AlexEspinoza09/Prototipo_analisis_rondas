import csv
from datetime import datetime, timedelta, timezone

from app.export_dataset import export
from app.models import ActivityLabel, PatrolSession, SessionStatus, TelemetryPoint
from tests.factories import CP_LAT, CP_LNG, create_guard, create_patrol_scenario, lat_offset

FULL_FEATURES = {
    "accel_magnitude": 2.2,
    "accel_std": 1.18,
    "accel_max": 6.4,
    "accel_dominant_hz": 1.9,
    "accel_peak_ratio": 0.36,
    "gyro_magnitude": 1.35,
    "gyro_std": 0.81,
    "gyro_max": 4.1,
    "gyro_dominant_hz": 2.0,
    "gyro_peak_ratio": 0.29,
    "sensor_sample_count": 98,
}


def _labelled_session(
    db,
    guard_id: int,
    route_id: int,
    label: ActivityLabel,
    *,
    points: int = 3,
    complete: bool = True,
    offset_days: int = 0,
) -> PatrolSession:
    started = datetime.now(timezone.utc) - timedelta(days=offset_days, hours=1)
    session = PatrolSession(
        guard_id=guard_id,
        route_id=route_id,
        device_id="collector",
        status=SessionStatus.completed,
        started_at=started,
        ended_at=started + timedelta(minutes=30),
        activity_label=label,
    )
    db.add(session)
    db.flush()

    features = dict(FULL_FEATURES)
    if not complete:
        # A window too short for a spectrum: unusable for training.
        features["accel_dominant_hz"] = None
        features["accel_peak_ratio"] = None

    for i in range(points):
        db.add(
            TelemetryPoint(
                session_id=session.id,
                recorded_at=started + timedelta(seconds=15 * i),
                location=f"SRID=4326;POINT({CP_LNG} {CP_LAT + lat_offset(i)})",
                accuracy_m=8.0,
                speed_mps=1.2,
                is_moving=True,
                **features,
            )
        )
    db.commit()
    return session


def _read_csv(path):
    with path.open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_export_never_splits_one_session_across_train_and_test(db, client, tmp_path):
    """The whole point of the exporter: no leakage between train and test."""
    scenario = create_patrol_scenario(db, client)
    for label in (ActivityLabel.walking, ActivityLabel.still):
        for day in range(4):
            _labelled_session(
                db, scenario.guard.id, scenario.route.id, label, offset_days=day
            )

    out = tmp_path / "dataset.csv"
    export(db, out, test_ratio=0.25, seed=42)
    rows = _read_csv(out)

    splits_per_session: dict[str, set[str]] = {}
    for row in rows:
        splits_per_session.setdefault(row["session_id"], set()).add(row["split"])
    assert all(len(splits) == 1 for splits in splits_per_session.values())
    # Both sides are actually populated, per label.
    assert {row["split"] for row in rows} == {"train", "test"}
    for label in ("walking", "still"):
        label_rows = [row for row in rows if row["label"] == label]
        assert {row["split"] for row in label_rows} == {"train", "test"}


def test_export_drops_windows_with_incomplete_features(db, client, tmp_path):
    scenario = create_patrol_scenario(db, client)
    _labelled_session(db, scenario.guard.id, scenario.route.id, ActivityLabel.walking)
    _labelled_session(
        db, scenario.guard.id, scenario.route.id, ActivityLabel.walking, complete=False
    )

    out = tmp_path / "dataset.csv"
    written = export(db, out, test_ratio=0.25, seed=42)

    # Only the complete session survives; nothing was imputed.
    assert written == 3
    rows = _read_csv(out)
    assert all(row["accel_dominant_hz"] for row in rows)


def test_export_keeps_single_session_label_in_train(db, client, tmp_path):
    """One session for a class cannot be evaluated, so it must not eat the test set."""
    scenario = create_patrol_scenario(db, client)
    _labelled_session(db, scenario.guard.id, scenario.route.id, ActivityLabel.vehicle)
    for day in range(2):
        _labelled_session(
            db, scenario.guard.id, scenario.route.id, ActivityLabel.walking, offset_days=day
        )

    out = tmp_path / "dataset.csv"
    export(db, out, test_ratio=0.5, seed=42)
    rows = _read_csv(out)

    vehicle_splits = {row["split"] for row in rows if row["label"] == "vehicle"}
    assert vehicle_splits == {"train"}


def test_export_ignores_unlabelled_sessions(db, client, tmp_path):
    """Real patrols must never leak into the training set."""
    scenario = create_patrol_scenario(db, client)  # session with activity_label = NULL
    db.add(
        TelemetryPoint(
            session_id=scenario.session.id,
            recorded_at=datetime.now(timezone.utc),
            location=f"SRID=4326;POINT({CP_LNG} {CP_LAT})",
            accuracy_m=8.0,
            **FULL_FEATURES,
        )
    )
    db.commit()

    out = tmp_path / "dataset.csv"
    written = export(db, out, test_ratio=0.25, seed=42)

    assert written == 0
    assert not out.exists()


def test_patch_label_sets_and_clears(db, client):
    scenario = create_patrol_scenario(db, client)

    response = client.patch(
        f"/sessions/{scenario.session.id}/label",
        json={"activity_label": "vehicle"},
        headers=scenario.headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["activity_label"] == "vehicle"

    cleared = client.patch(
        f"/sessions/{scenario.session.id}/label",
        json={"activity_label": None},
        headers=scenario.headers,
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["activity_label"] is None


def test_patch_label_rejects_unknown_activity(db, client):
    scenario = create_patrol_scenario(db, client)

    response = client.patch(
        f"/sessions/{scenario.session.id}/label",
        json={"activity_label": "flying"},
        headers=scenario.headers,
    )

    assert response.status_code == 422


def test_patch_label_forbidden_for_another_guard(db, client):
    scenario = create_patrol_scenario(db, client)
    create_guard(db, email="otro@test.ec")
    from tests.factories import auth_headers

    response = client.patch(
        f"/sessions/{scenario.session.id}/label",
        json={"activity_label": "walking"},
        headers=auth_headers(client, "otro@test.ec"),
    )

    assert response.status_code == 403
