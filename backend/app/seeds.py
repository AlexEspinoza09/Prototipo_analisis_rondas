"""Development seed data.

Run inside the api container:
    docker compose exec api python -m app.seeds

Idempotent: skips everything if the admin user already exists.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import (
    Checkpoint,
    PatrolMode,
    Route,
    RouteCheckpoint,
    Site,
    User,
    UserRole,
)

ADMIN_EMAIL = "admin@rondas.demo"
GUARD_EMAILS = ("guardia1@rondas.demo", "guardia2@rondas.demo")

# Generic demo facility: a ~500 x 330 m perimeter (~1.7 km, ~25 min on foot)
# in northern Quito. Offsets are the walking time from the first checkpoint.
# (name, lng, lat, expected_offset_min)
CHECKPOINT_DATA = [
    ("Garita principal", -78.4855, -0.1855, 0),
    ("Bodega", -78.4810, -0.1855, 7),
    ("Cuarto de máquinas", -78.4810, -0.1825, 12),
    ("Acceso posterior", -78.4855, -0.1825, 19),
]
ROUTE_DURATION_MIN = 25


def point_wkt(lng: float, lat: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


def seed(db: Session) -> None:
    if db.query(User).filter(User.email == ADMIN_EMAIL).first():
        print("Seed data already present, nothing to do.")
        return

    users = [
        User(
            full_name="Administrador del Sistema",
            email=ADMIN_EMAIL,
            hashed_password=hash_password("Admin123!"),
            role=UserRole.admin,
        ),
        User(
            full_name="Carlos Quishpe",
            email=GUARD_EMAILS[0],
            hashed_password=hash_password("Guardia123!"),
            role=UserRole.guard,
        ),
        User(
            full_name="María Tipán",
            email=GUARD_EMAILS[1],
            hashed_password=hash_password("Guardia123!"),
            role=UserRole.guard,
        ),
    ]
    db.add_all(users)

    site = Site(
        name="Instalación de demostración",
        address="Quito, Ecuador (ubicación ficticia de demostración)",
    )
    db.add(site)
    db.flush()

    checkpoints = [
        Checkpoint(
            site_id=site.id,
            name=name,
            qr_code=uuid.uuid4(),
            location=point_wkt(lng, lat),
            radius_m=30,
        )
        for name, lng, lat, _ in CHECKPOINT_DATA
    ]
    db.add_all(checkpoints)
    db.flush()

    # Closed loop through the four checkpoints, back to the start.
    coords = [(lng, lat) for _, lng, lat, _ in CHECKPOINT_DATA]
    coords.append(coords[0])
    linestring = ", ".join(f"{lng} {lat}" for lng, lat in coords)
    route = Route(
        site_id=site.id,
        name="Ronda perimetral",
        expected_path=f"SRID=4326;LINESTRING({linestring})",
        expected_duration_min=ROUTE_DURATION_MIN,
        patrol_mode=PatrolMode.foot,
    )
    db.add(route)
    db.flush()

    db.add_all(
        RouteCheckpoint(
            route_id=route.id,
            checkpoint_id=checkpoint.id,
            sequence_order=order,
            expected_offset_min=offset,
        )
        for order, (checkpoint, (_, _, _, offset)) in enumerate(
            zip(checkpoints, CHECKPOINT_DATA), start=1
        )
    )

    db.commit()
    print("Seed data created:")
    print(f"  admin:    {ADMIN_EMAIL} / Admin123!")
    print(f"  guards:   {', '.join(GUARD_EMAILS)} / Guardia123!")
    print(f"  site:     {site.name} ({len(checkpoints)} checkpoints)")
    print(f"  route:    {route.name}")
    for checkpoint in checkpoints:
        print(f"  QR {checkpoint.name}: {checkpoint.qr_code}")


def main() -> None:
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
