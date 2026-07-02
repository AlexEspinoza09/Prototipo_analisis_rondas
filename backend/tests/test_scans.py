"""Business rules 1 (geographic validation) and 2 (prior inactivity)."""

from sqlalchemy import select

from app.models import Anomaly, AnomalySeverity, AnomalyType
from tests.factories import (
    CP_LAT,
    CP_LNG,
    add_telemetry_window,
    create_patrol_scenario,
    lat_offset,
)


def _scan_payload(scenario, distance_m: float) -> dict:
    return {
        "session_id": scenario.session.id,
        "qr_code": str(scenario.checkpoint.qr_code),
        "lat": CP_LAT + lat_offset(distance_m),
        "lng": CP_LNG,
    }


def test_scan_inside_radius_with_movement_is_valid(db, client):
    scenario = create_patrol_scenario(db, client)
    add_telemetry_window(db, scenario.session.id, accel_magnitude=2.5, is_moving=True)

    response = client.post("/scans", json=_scan_payload(scenario, 10), headers=scenario.headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_valid"] is True
    assert body["invalid_reason"] is None
    assert body["distance_to_checkpoint_m"] < 30
    assert db.scalars(select(Anomaly)).all() == []


def test_scan_outside_radius_is_rejected_with_fraud_anomaly(db, client):
    scenario = create_patrol_scenario(db, client)
    add_telemetry_window(db, scenario.session.id, accel_magnitude=2.5, is_moving=True)

    response = client.post("/scans", json=_scan_payload(scenario, 200), headers=scenario.headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_valid"] is False
    assert body["invalid_reason"] == "out_of_range"
    assert 190 <= body["distance_to_checkpoint_m"] <= 210

    anomalies = db.scalars(select(Anomaly)).all()
    assert len(anomalies) == 1
    anomaly = anomalies[0]
    assert anomaly.type == AnomalyType.fraudulent_scan
    assert anomaly.guard_id == scenario.guard.id
    assert anomaly.session_id == scenario.session.id
    assert anomaly.severity == AnomalySeverity.high  # 200 m >= 5x the 30 m radius
    assert 190 <= anomaly.details["distance_m"] <= 210
    assert anomaly.details["radius_m"] == 30


def test_scan_without_prior_movement_creates_inactivity_anomaly(db, client):
    scenario = create_patrol_scenario(db, client)
    add_telemetry_window(db, scenario.session.id, accel_magnitude=0.3, is_moving=False)

    response = client.post("/scans", json=_scan_payload(scenario, 10), headers=scenario.headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_valid"] is False
    assert body["invalid_reason"] == "no_prior_movement"

    anomalies = db.scalars(select(Anomaly)).all()
    assert len(anomalies) == 1
    anomaly = anomalies[0]
    assert anomaly.type == AnomalyType.inactivity
    assert anomaly.details["avg_accel_magnitude"] < 1.2
    assert anomaly.details["still_ratio"] == 1.0


def test_scan_with_no_telemetry_is_accepted(db, client):
    """Rule 2 is deferred when there is no telemetry to judge."""
    scenario = create_patrol_scenario(db, client)

    response = client.post("/scans", json=_scan_payload(scenario, 10), headers=scenario.headers)

    assert response.status_code == 201, response.text
    assert response.json()["is_valid"] is True
    assert db.scalars(select(Anomaly)).all() == []


def test_repeated_scan_is_marked_duplicate(db, client):
    scenario = create_patrol_scenario(db, client)
    add_telemetry_window(db, scenario.session.id, accel_magnitude=2.5, is_moving=True)
    payload = _scan_payload(scenario, 10)

    first = client.post("/scans", json=payload, headers=scenario.headers)
    second = client.post("/scans", json=payload, headers=scenario.headers)

    assert first.json()["is_valid"] is True
    assert second.status_code == 201
    assert second.json()["is_valid"] is False
    assert second.json()["invalid_reason"] == "duplicate"
    # Duplicates do not create anomalies by themselves.
    assert db.scalars(select(Anomaly)).all() == []


def test_scan_with_unknown_qr_returns_404(db, client):
    scenario = create_patrol_scenario(db, client)
    payload = _scan_payload(scenario, 10)
    payload["qr_code"] = "00000000-0000-0000-0000-000000000000"

    response = client.post("/scans", json=payload, headers=scenario.headers)

    assert response.status_code == 404
