from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models import TelemetryPoint
from tests.factories import CP_LAT, CP_LNG, create_patrol_scenario, lat_offset


def _batch_payload(session_id: int, n: int = 4) -> dict:
    base = datetime.now(timezone.utc) - timedelta(minutes=2)
    return {
        "session_id": session_id,
        "points": [
            {
                "recorded_at": (base + timedelta(seconds=15 * i)).isoformat(),
                "lat": CP_LAT + lat_offset(2.0 * i),
                "lng": CP_LNG,
                "accuracy_m": 8.5,
                "speed_mps": 1.1,
                "accel_magnitude": 2.2,
                "gyro_magnitude": 1.35,
                "accel_std": 1.18,
                "accel_max": 6.4,
                "gyro_std": 0.81,
                "gyro_max": 4.1,
                "accel_dominant_hz": 1.9,
                "accel_peak_ratio": 0.36,
                "gyro_dominant_hz": 2.0,
                "gyro_peak_ratio": 0.29,
                "sensor_sample_count": 98,
                "is_moving": True,
            }
            for i in range(n)
        ],
    }


def test_batch_ingest_inserts_points(db, client):
    scenario = create_patrol_scenario(db, client)
    payload = _batch_payload(scenario.session.id)

    response = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert response.status_code == 200, response.text
    assert response.json() == {"received": 4, "inserted": 4, "duplicates": 0}
    count = db.scalar(select(func.count()).select_from(TelemetryPoint))
    assert count == 4


def test_batch_ingest_is_idempotent(db, client):
    scenario = create_patrol_scenario(db, client)
    payload = _batch_payload(scenario.session.id)

    first = client.post("/telemetry/batch", json=payload, headers=scenario.headers)
    second = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert first.json()["inserted"] == 4
    assert second.json() == {"received": 4, "inserted": 0, "duplicates": 4}
    count = db.scalar(select(func.count()).select_from(TelemetryPoint))
    assert count == 4


def test_batch_ingest_persists_both_sensor_magnitudes(db, client):
    scenario = create_patrol_scenario(db, client)

    response = client.post(
        "/telemetry/batch", json=_batch_payload(scenario.session.id), headers=scenario.headers
    )

    assert response.status_code == 200, response.text
    rows = db.execute(
        select(TelemetryPoint.accel_magnitude, TelemetryPoint.gyro_magnitude)
    ).all()
    assert len(rows) == 4
    assert all(row.accel_magnitude == 2.2 and row.gyro_magnitude == 1.35 for row in rows)


def test_batch_ingest_accepts_points_without_sensor_readings(db, client):
    """A window where the sensors reported nothing must still store the fix."""
    scenario = create_patrol_scenario(db, client)
    payload = _batch_payload(scenario.session.id, n=2)
    sensor_keys = [
        key
        for key in payload["points"][0]
        if key.startswith(("accel_", "gyro_", "sensor_"))
    ]
    for point in payload["points"]:
        for key in sensor_keys:
            del point[key]
        point["is_moving"] = None

    response = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert response.status_code == 200, response.text
    points = db.execute(select(TelemetryPoint)).scalars().all()
    assert len(points) == 2
    # The GPS fix is still recorded; only the sensor side is empty.
    assert all(point.accuracy_m == 8.5 for point in points)
    assert all(
        getattr(point, key) is None for point in points for key in sensor_keys
    )


def test_batch_ingest_persists_activity_features(db, client):
    """The HAR feature set must survive ingestion intact — it is the training data."""
    scenario = create_patrol_scenario(db, client)

    response = client.post(
        "/telemetry/batch", json=_batch_payload(scenario.session.id, n=1), headers=scenario.headers
    )

    assert response.status_code == 200, response.text
    point = db.execute(select(TelemetryPoint)).scalar_one()
    assert point.accel_std == 1.18
    assert point.accel_max == 6.4
    assert point.gyro_std == 0.81
    assert point.gyro_max == 4.1
    assert point.accel_dominant_hz == 1.9
    assert point.accel_peak_ratio == 0.36
    assert point.gyro_dominant_hz == 2.0
    assert point.gyro_peak_ratio == 0.29
    assert point.sensor_sample_count == 98


def test_batch_rejects_peak_ratio_above_one(db, client):
    """peak_ratio is a share of band power, so values over 1 are malformed."""
    scenario = create_patrol_scenario(db, client)
    payload = _batch_payload(scenario.session.id, n=1)
    payload["points"][0]["accel_peak_ratio"] = 1.4

    response = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert response.status_code == 422


def test_batch_rejects_negative_gyro_magnitude(db, client):
    scenario = create_patrol_scenario(db, client)
    payload = _batch_payload(scenario.session.id, n=1)
    payload["points"][0]["gyro_magnitude"] = -0.5

    response = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert response.status_code == 422


def test_batch_for_unknown_session_returns_404(db, client):
    scenario = create_patrol_scenario(db, client)
    payload = _batch_payload(999_999)

    response = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert response.status_code == 404
