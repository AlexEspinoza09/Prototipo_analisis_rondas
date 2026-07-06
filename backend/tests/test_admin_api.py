"""Anomalies listing/review, dashboard summary and admin CRUD endpoints."""

from datetime import datetime, timezone

from app.models import Anomaly, AnomalySeverity, AnomalyType
from tests.factories import (
    auth_headers,
    create_patrol_scenario,
    create_staff,
)


def _staff_headers(db, client):
    staff = create_staff(db)
    return auth_headers(client, staff.email)


def test_anomalies_filters_and_review(db, client):
    scenario = create_patrol_scenario(db, client)
    headers = _staff_headers(db, client)
    db.add_all(
        [
            Anomaly(
                session_id=scenario.session.id,
                guard_id=scenario.guard.id,
                type=AnomalyType.fraudulent_scan,
                severity=AnomalySeverity.high,
                detected_at=datetime.now(timezone.utc),
                details={"distance_m": 200},
            ),
            Anomaly(
                session_id=scenario.session.id,
                guard_id=scenario.guard.id,
                type=AnomalyType.inactivity,
                severity=AnomalySeverity.medium,
                detected_at=datetime.now(timezone.utc),
                details={},
            ),
        ]
    )
    db.commit()

    all_rows = client.get("/anomalies", headers=headers).json()
    assert len(all_rows) == 2
    assert all_rows[0]["guard_name"] == scenario.guard.full_name

    frauds = client.get("/anomalies?type=fraudulent_scan", headers=headers).json()
    assert len(frauds) == 1
    assert frauds[0]["details"]["distance_m"] == 200

    reviewed = client.patch(
        f"/anomalies/{frauds[0]['id']}", json={"reviewed": True}, headers=headers
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["reviewed"] is True

    pending = client.get("/anomalies?reviewed=false", headers=headers).json()
    assert len(pending) == 1

    # Guards must not access the anomalies board.
    assert client.get("/anomalies", headers=scenario.headers).status_code == 403


def test_dashboard_summary_shape(db, client):
    scenario = create_patrol_scenario(db, client)
    headers = _staff_headers(db, client)

    body = client.get("/dashboard/summary", headers=headers).json()

    assert body["totals"]["sessions_today"] == 1
    assert body["totals"]["open_anomalies"] == 0
    assert body["sessions_per_day"][-1]["count"] == 1
    guard_row = next(
        g for g in body["guard_activity"] if g["guard_id"] == scenario.guard.id
    )
    assert guard_row["sessions_7d"] == 0  # fixture session is still in progress


def test_checkpoint_crud_roundtrip(db, client):
    scenario = create_patrol_scenario(db, client)
    headers = _staff_headers(db, client)

    created = client.post(
        "/checkpoints",
        json={"site_id": scenario.site.id, "name": "Nuevo punto", "lat": -0.17, "lng": -78.49},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    checkpoint = created.json()
    assert checkpoint["radius_m"] == 30
    assert checkpoint["qr_code"]
    assert abs(checkpoint["lat"] - -0.17) < 1e-6

    updated = client.patch(
        f"/checkpoints/{checkpoint['id']}",
        json={"radius_m": 50, "is_active": False},
        headers=headers,
    )
    assert updated.json()["radius_m"] == 50
    assert updated.json()["is_active"] is False

    assert (
        client.delete(f"/checkpoints/{checkpoint['id']}", headers=headers).status_code == 204
    )
    remaining = client.get(
        f"/checkpoints?site_id={scenario.site.id}", headers=headers
    ).json()
    assert all(c["id"] != checkpoint["id"] for c in remaining)

    # Guards cannot create checkpoints.
    forbidden = client.post(
        "/checkpoints",
        json={"site_id": scenario.site.id, "name": "x", "lat": 0, "lng": 0},
        headers=scenario.headers,
    )
    assert forbidden.status_code == 403


def test_route_crud_roundtrip(db, client):
    scenario = create_patrol_scenario(db, client)
    headers = _staff_headers(db, client)

    created = client.post(
        "/routes",
        json={
            "site_id": scenario.site.id,
            "name": "Ruta nueva",
            "expected_duration_min": 20,
            "path": [[-78.488, -0.176], [-78.488, -0.174]],
            "checkpoints": [
                {
                    "checkpoint_id": scenario.checkpoint.id,
                    "sequence_order": 1,
                    "expected_offset_min": 0,
                }
            ],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    route = created.json()
    assert route["path"] == [[-78.488, -0.176], [-78.488, -0.174]]
    assert route["checkpoints"][0]["name"] == scenario.checkpoint.name

    updated = client.patch(
        f"/routes/{route['id']}", json={"expected_duration_min": 25}, headers=headers
    )
    assert updated.json()["expected_duration_min"] == 25

    assert client.delete(f"/routes/{route['id']}", headers=headers).status_code == 204
    # The scenario route has a session attached: deletion must be refused.
    assert (
        client.delete(f"/routes/{scenario.route.id}", headers=headers).status_code == 409
    )


def test_user_crud_roundtrip(db, client):
    headers = _staff_headers(db, client)

    created = client.post(
        "/users",
        json={
            "full_name": "Guardia Nuevo",
            "email": "nuevo@test.ec",
            "password": "Secreta123!",
            "role": "guard",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    new_user = created.json()

    duplicate = client.post(
        "/users",
        json={
            "full_name": "Otro",
            "email": "nuevo@test.ec",
            "password": "Secreta123!",
            "role": "guard",
        },
        headers=headers,
    )
    assert duplicate.status_code == 409

    guards = client.get("/users?role=guard", headers=headers).json()
    assert any(u["id"] == new_user["id"] for u in guards)

    deactivated = client.patch(
        f"/users/{new_user['id']}", json={"is_active": False}, headers=headers
    )
    assert deactivated.json()["is_active"] is False

    assert client.delete(f"/users/{new_user['id']}", headers=headers).status_code == 204


def test_auth_me_returns_current_user(db, client):
    scenario = create_patrol_scenario(db, client)
    body = client.get("/auth/me", headers=scenario.headers).json()
    assert body["email"] == scenario.guard.email
    assert body["role"] == "guard"
