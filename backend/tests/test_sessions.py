from sqlalchemy import select

from app.models import PatrolSession, SessionStatus
from tests.factories import auth_headers, create_guard, create_patrol_scenario


def test_start_and_end_session(db, client):
    scenario = create_patrol_scenario(db, client)
    # End the fixture's in-progress session first so the guard can start anew.
    ended = client.post(f"/sessions/{scenario.session.id}/end", headers=scenario.headers)
    assert ended.status_code == 200
    assert ended.json()["status"] == "completed"
    assert ended.json()["ended_at"] is not None

    started = client.post(
        "/sessions/start",
        json={"route_id": scenario.route.id, "device_id": "android-123"},
        headers=scenario.headers,
    )
    assert started.status_code == 201, started.text
    body = started.json()
    assert body["status"] == "in_progress"
    assert body["guard_id"] == scenario.guard.id

    sessions = db.scalars(select(PatrolSession)).all()
    assert len(sessions) == 2


def test_guard_cannot_have_two_sessions_in_progress(db, client):
    scenario = create_patrol_scenario(db, client)

    response = client.post(
        "/sessions/start",
        json={"route_id": scenario.route.id, "device_id": "android-123"},
        headers=scenario.headers,
    )

    assert response.status_code == 409


def test_guard_cannot_end_another_guards_session(db, client):
    scenario = create_patrol_scenario(db, client)
    other = create_guard(db, email="otro@test.ec")
    other_headers = auth_headers(client, other.email)

    response = client.post(f"/sessions/{scenario.session.id}/end", headers=other_headers)

    assert response.status_code == 403
    db.refresh(scenario.session)
    assert scenario.session.status == SessionStatus.in_progress


def test_my_sessions_returns_only_own_history(db, client):
    scenario = create_patrol_scenario(db, client)
    other = create_guard(db, email="otro@test.ec")
    other_headers = auth_headers(client, other.email)

    mine = client.get("/sessions/mine", headers=scenario.headers)
    assert mine.status_code == 200
    assert [s["id"] for s in mine.json()] == [scenario.session.id]
    assert mine.json()[0]["route_name"] == scenario.route.name

    assert client.get("/sessions/mine", headers=other_headers).json() == []


def test_track_returns_geojson_feature(db, client):
    from tests.factories import add_telemetry_window

    scenario = create_patrol_scenario(db, client)
    add_telemetry_window(db, scenario.session.id, accel_magnitude=2.0, is_moving=True)

    response = client.get(f"/sessions/{scenario.session.id}/track", headers=scenario.headers)

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "Feature"
    assert body["geometry"]["type"] == "LineString"
    assert body["properties"]["point_count"] == 10
    assert len(body["geometry"]["coordinates"]) == 10
