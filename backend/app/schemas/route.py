from pydantic import BaseModel, Field

# A path is a list of [lng, lat] pairs (GeoJSON coordinate order).
PathCoords = list[list[float]]


class RouteCheckpointIn(BaseModel):
    checkpoint_id: int
    sequence_order: int = Field(ge=1)
    expected_offset_min: int = Field(ge=0)


class RouteIn(BaseModel):
    site_id: int
    name: str = Field(min_length=1, max_length=120)
    expected_duration_min: int = Field(ge=1)
    path: PathCoords | None = Field(default=None, min_length=2)
    checkpoints: list[RouteCheckpointIn] = []


class RouteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    expected_duration_min: int | None = Field(default=None, ge=1)
    path: PathCoords | None = Field(default=None, min_length=2)
    checkpoints: list[RouteCheckpointIn] | None = None
    is_active: bool | None = None


class RouteCheckpointOut(BaseModel):
    checkpoint_id: int
    name: str
    sequence_order: int
    expected_offset_min: int
    lat: float
    lng: float
    radius_m: int


class RouteOut(BaseModel):
    id: int
    site_id: int
    name: str
    expected_duration_min: int
    is_active: bool
    path: PathCoords | None
    checkpoints: list[RouteCheckpointOut]
