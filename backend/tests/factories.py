"""Small helpers to build test data and authenticate against the API."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import (
    Checkpoint,
    PatrolSession,
    Route,
    SessionStatus,
    Site,
    TelemetryPoint,
    User,
    UserRole,
)

GUARD_PASSWORD = "Secreta123!"

# Reference checkpoint in Quito used by the geographic tests.
CP_LNG, CP_LAT = -78.4880, -0.1760

# 1 degree of latitude ~= 111,320 m, good enough near the equator.
METERS_PER_DEG_LAT = 111_320.0


def lat_offset(meters: float) -> float:
    return meters / METERS_PER_DEG_LAT


def create_guard(db: Session, email: str = "guardia@test.ec") -> User:
    guard = User(
        full_name="Guardia de Prueba",
        email=email,
        hashed_password=hash_password(GUARD_PASSWORD),
        role=UserRole.guard,
    )
    db.add(guard)
    db.commit()
    return guard


def create_staff(
    db: Session, email: str = "supervisor@test.ec", role: UserRole = UserRole.supervisor
) -> User:
    staff = User(
        full_name="Supervisor de Prueba",
        email=email,
        hashed_password=hash_password(GUARD_PASSWORD),
        role=role,
    )
    db.add(staff)
    db.commit()
    return staff


def auth_headers(client: TestClient, email: str, password: str = GUARD_PASSWORD) -> dict[str, str]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_patrol_scenario(db: Session, client: TestClient) -> SimpleNamespace:
    """Guard + site + one checkpoint + route + in-progress session + auth headers."""
    guard = create_guard(db)
    site = Site(name="Sitio de Prueba", address="Quito")
    db.add(site)
    db.flush()
    checkpoint = Checkpoint(
        site_id=site.id,
        name="Garita de prueba",
        qr_code=uuid.uuid4(),
        location=f"SRID=4326;POINT({CP_LNG} {CP_LAT})",
        radius_m=30,
    )
    route = Route(site_id=site.id, name="Ruta de prueba", expected_duration_min=30)
    db.add_all([checkpoint, route])
    db.flush()
    session = PatrolSession(
        guard_id=guard.id,
        route_id=route.id,
        device_id="test-device",
        status=SessionStatus.in_progress,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
    )
    db.add(session)
    db.commit()

    return SimpleNamespace(
        guard=guard,
        site=site,
        checkpoint=checkpoint,
        route=route,
        session=session,
        headers=auth_headers(client, guard.email),
    )


def add_telemetry_window(
    db: Session,
    session_id: int,
    *,
    accel_magnitude: float,
    is_moving: bool,
    minutes: int = 5,
    interval_s: int = 30,
) -> int:
    """Insert telemetry covering the `minutes` before now, at the checkpoint."""
    now = datetime.now(timezone.utc)
    count = 0
    seconds = minutes * 60
    for elapsed in range(0, seconds, interval_s):
        db.add(
            TelemetryPoint(
                session_id=session_id,
                recorded_at=now - timedelta(seconds=seconds - elapsed),
                location=f"SRID=4326;POINT({CP_LNG} {CP_LAT + lat_offset(elapsed / 10)})",
                accuracy_m=8.0,
                speed_mps=1.2 if is_moving else 0.0,
                accel_magnitude=accel_magnitude,
                is_moving=is_moving,
            )
        )
        count += 1
    db.commit()
    return count
