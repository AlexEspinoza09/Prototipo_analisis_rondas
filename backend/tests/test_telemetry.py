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
    for point in payload["points"]:
        del point["accel_magnitude"]
        del point["gyro_magnitude"]
        point["is_moving"] = None

    response = client.post("/telemetry/batch", json=payload, headers=scenario.headers)

    assert response.status_code == 200, response.text
    rows = db.execute(
        select(TelemetryPoint.accel_magnitude, TelemetryPoint.gyro_magnitude)
    ).all()
    assert len(rows) == 2
    assert all(row.accel_magnitude is None and row.gyro_magnitude is None for row in rows)


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
