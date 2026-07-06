"""Test fixtures: real PostGIS database (rondas_test), recreated per test run.

The geographic rules under test (ST_Distance over geography) cannot be
faithfully simulated with SQLite, so tests run against the same postgres
container used in development.
"""

from collections.abc import Generator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.db import get_db
from app.main import app
from app.models import Base

TEST_DB_NAME = "rondas_test"

ALL_TABLES = (
    "anomalies, scans, telemetry_points, patrol_sessions, "
    "route_checkpoints, routes, checkpoints, sites, users"
)


@pytest.fixture(scope="session")
def engine() -> Generator[Engine, None, None]:
    admin_engine = create_engine(settings.database_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB_NAME} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {TEST_DB_NAME}"))
    admin_engine.dispose()

    test_url = settings.database_url.rsplit("/", 1)[0] + f"/{TEST_DB_NAME}"
    test_engine = create_engine(test_url)
    with test_engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.create_all(test_engine)
    with test_engine.begin() as conn:
        # create_all builds the partitioned parent only; one catch-all
        # partition is enough for tests.
        conn.execute(
            text("CREATE TABLE telemetry_points_default PARTITION OF telemetry_points DEFAULT")
        )

    yield test_engine
    test_engine.dispose()


@pytest.fixture()
def db(engine: Engine) -> Generator[Session, None, None]:
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSession()
    yield session
    session.close()
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {ALL_TABLES} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def _no_celery_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    """API endpoints must not enqueue real Celery tasks during tests."""
    monkeypatch.setattr(
        "app.api.sessions.analyze_session_route_task",
        SimpleNamespace(delay=lambda *args, **kwargs: None),
    )


@pytest.fixture()
def client(db: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
