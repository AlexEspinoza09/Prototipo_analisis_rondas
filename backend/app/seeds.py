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
    Route,
    RouteCheckpoint,
    Site,
    User,
    UserRole,
)

ADMIN_EMAIL = "admin@protemaxi.ec"

# Checkpoints around a city block in Quito (Av. Amazonas / Naciones Unidas area).
# (name, lng, lat, expected_offset_min)
CHECKPOINT_DATA = [
    ("Garita principal", -78.4880, -0.1760, 0),
    ("Bodega norte", -78.4872, -0.1752, 7),
    ("Parqueadero posterior", -78.4864, -0.1760, 14),
    ("Acceso sur", -78.4872, -0.1768, 21),
]


def point_wkt(lng: float, lat: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


def seed(db: Session) -> None:
    if db.query(User).filter(User.email == ADMIN_EMAIL).first():
        print("Seed data already present, nothing to do.")
        return

    users = [
        User(
            full_name="Administrador Protemaxi",
            email=ADMIN_EMAIL,
            hashed_password=hash_password("Admin123!"),
            role=UserRole.admin,
        ),
        User(
            full_name="Carlos Quishpe",
            email="guardia1@protemaxi.ec",
            hashed_password=hash_password("Guardia123!"),
            role=UserRole.guard,
        ),
        User(
            full_name="María Tipán",
            email="guardia2@protemaxi.ec",
            hashed_password=hash_password("Guardia123!"),
            role=UserRole.guard,
        ),
    ]
    db.add_all(users)

    site = Site(
        name="Planta Industrial Norte",
        address="Av. Amazonas y Naciones Unidas, Quito, Ecuador",
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
        name="Ronda nocturna perímetro",
        expected_path=f"SRID=4326;LINESTRING({linestring})",
        expected_duration_min=30,
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
    print("  guards:   guardia1@protemaxi.ec, guardia2@protemaxi.ec / Guardia123!")
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
