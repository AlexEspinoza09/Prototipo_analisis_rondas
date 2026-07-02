from tests.factories import GUARD_PASSWORD, create_guard


def test_login_returns_token_pair(db, client):
    guard = create_guard(db)

    response = client.post(
        "/auth/login", json={"email": guard.email, "password": GUARD_PASSWORD}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_login_with_wrong_password_fails(db, client):
    guard = create_guard(db)

    response = client.post(
        "/auth/login", json={"email": guard.email, "password": "incorrecta"}
    )

    assert response.status_code == 401


def test_refresh_returns_new_pair(db, client):
    guard = create_guard(db)
    login = client.post("/auth/login", json={"email": guard.email, "password": GUARD_PASSWORD})
    refresh_token = login.json()["refresh_token"]

    response = client.post("/auth/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    assert response.json()["access_token"]


def test_access_token_cannot_be_used_as_refresh(db, client):
    guard = create_guard(db)
    login = client.post("/auth/login", json={"email": guard.email, "password": GUARD_PASSWORD})
    access_token = login.json()["access_token"]

    response = client.post("/auth/refresh", json={"refresh_token": access_token})

    assert response.status_code == 401


def test_protected_endpoint_requires_token(db, client):
    response = client.post("/sessions/start", json={"route_id": 1, "device_id": "x"})
    assert response.status_code == 401
