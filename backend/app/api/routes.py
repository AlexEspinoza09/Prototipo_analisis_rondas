import json

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2 import Geometry
from sqlalchemy import cast, delete, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_roles
from app.models import Checkpoint, PatrolSession, Route, RouteCheckpoint, User, UserRole
from app.schemas.route import (
    PathCoords,
    RouteCheckpointIn,
    RouteCheckpointOut,
    RouteIn,
    RouteOut,
    RouteUpdate,
)

router = APIRouter(prefix="/routes", tags=["routes"])

_staff = require_roles(UserRole.admin, UserRole.supervisor)

_cp_geom = cast(Checkpoint.location, Geometry())


def _path_to_ewkt(path: PathCoords) -> str:
    for pair in path:
        if len(pair) != 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Each path coordinate must be [lng, lat]",
            )
    coords = ", ".join(f"{lng} {lat}" for lng, lat in path)
    return f"SRID=4326;LINESTRING({coords})"


def _route_checkpoints_out(db: Session, route_ids: list[int]) -> dict[int, list[RouteCheckpointOut]]:
    result: dict[int, list[RouteCheckpointOut]] = {route_id: [] for route_id in route_ids}
    if not route_ids:
        return result
    rows = db.execute(
        select(
            RouteCheckpoint,
            Checkpoint.name,
            Checkpoint.radius_m,
            func.ST_X(_cp_geom),
            func.ST_Y(_cp_geom),
        )
        .join(Checkpoint, RouteCheckpoint.checkpoint_id == Checkpoint.id)
        .where(RouteCheckpoint.route_id.in_(route_ids))
        .order_by(RouteCheckpoint.route_id, RouteCheckpoint.sequence_order)
    )
    for rc, name, radius_m, lng, lat in rows:
        result[rc.route_id].append(
            RouteCheckpointOut(
                checkpoint_id=rc.checkpoint_id,
                name=name,
                sequence_order=rc.sequence_order,
                expected_offset_min=rc.expected_offset_min,
                lat=lat,
                lng=lng,
                radius_m=radius_m,
            )
        )
    return result


def _to_out(route: Route, path_geojson: str | None, checkpoints: list[RouteCheckpointOut]) -> RouteOut:
    path = json.loads(path_geojson)["coordinates"] if path_geojson else None
    return RouteOut(
        id=route.id,
        site_id=route.site_id,
        name=route.name,
        expected_duration_min=route.expected_duration_min,
        is_active=route.is_active,
        path=path,
        checkpoints=checkpoints,
    )


def _get_one(db: Session, route_id: int) -> RouteOut:
    row = db.execute(
        select(Route, func.ST_AsGeoJSON(cast(Route.expected_path, Geometry()))).where(
            Route.id == route_id
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")
    route, path_geojson = row
    return _to_out(route, path_geojson, _route_checkpoints_out(db, [route.id])[route.id])


def _replace_checkpoints(db: Session, route_id: int, items: list[RouteCheckpointIn]) -> None:
    db.execute(delete(RouteCheckpoint).where(RouteCheckpoint.route_id == route_id))
    for item in items:
        db.add(
            RouteCheckpoint(
                route_id=route_id,
                checkpoint_id=item.checkpoint_id,
                sequence_order=item.sequence_order,
                expected_offset_min=item.expected_offset_min,
            )
        )


@router.get("", response_model=list[RouteOut])
def list_routes(
    site_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RouteOut]:
    query = select(Route, func.ST_AsGeoJSON(cast(Route.expected_path, Geometry()))).order_by(
        Route.id
    )
    if site_id is not None:
        query = query.where(Route.site_id == site_id)
    rows = db.execute(query).all()
    checkpoints_by_route = _route_checkpoints_out(db, [route.id for route, _ in rows])
    return [
        _to_out(route, path_geojson, checkpoints_by_route[route.id])
        for route, path_geojson in rows
    ]


@router.get("/{route_id}", response_model=RouteOut)
def get_route(
    route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RouteOut:
    return _get_one(db, route_id)


@router.post("", response_model=RouteOut, status_code=status.HTTP_201_CREATED)
def create_route(
    payload: RouteIn, user: User = Depends(_staff), db: Session = Depends(get_db)
) -> RouteOut:
    route = Route(
        site_id=payload.site_id,
        name=payload.name,
        expected_duration_min=payload.expected_duration_min,
        expected_path=_path_to_ewkt(payload.path) if payload.path else None,
    )
    db.add(route)
    db.flush()
    _replace_checkpoints(db, route.id, payload.checkpoints)
    db.commit()
    return _get_one(db, route.id)


@router.patch("/{route_id}", response_model=RouteOut)
def update_route(
    route_id: int,
    payload: RouteUpdate,
    user: User = Depends(_staff),
    db: Session = Depends(get_db),
) -> RouteOut:
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")
    if payload.name is not None:
        route.name = payload.name
    if payload.expected_duration_min is not None:
        route.expected_duration_min = payload.expected_duration_min
    if payload.is_active is not None:
        route.is_active = payload.is_active
    if "path" in payload.model_fields_set:
        route.expected_path = _path_to_ewkt(payload.path) if payload.path else None
    if payload.checkpoints is not None:
        _replace_checkpoints(db, route_id, payload.checkpoints)
    db.commit()
    return _get_one(db, route_id)


@router.delete("/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(
    route_id: int, user: User = Depends(_staff), db: Session = Depends(get_db)
) -> None:
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")
    has_sessions = db.scalar(
        select(func.count()).select_from(PatrolSession).where(PatrolSession.route_id == route_id)
    )
    if has_sessions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Route has patrol sessions; deactivate it instead",
        )
    db.delete(route)
    db.commit()
