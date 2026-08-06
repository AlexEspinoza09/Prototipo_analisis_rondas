from pydantic import AwareDatetime, BaseModel, Field


class TelemetryPointIn(BaseModel):
    recorded_at: AwareDatetime
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0)
    speed_mps: float | None = Field(default=None, ge=0)
    accel_magnitude: float | None = Field(default=None, ge=0)
    gyro_magnitude: float | None = Field(default=None, ge=0)
    # Activity-recognition features; absent when the window was too short or the
    # sensor is missing, so every one of them is optional.
    accel_std: float | None = Field(default=None, ge=0)
    accel_max: float | None = Field(default=None, ge=0)
    gyro_std: float | None = Field(default=None, ge=0)
    gyro_max: float | None = Field(default=None, ge=0)
    accel_dominant_hz: float | None = Field(default=None, ge=0)
    accel_peak_ratio: float | None = Field(default=None, ge=0, le=1)
    gyro_dominant_hz: float | None = Field(default=None, ge=0)
    gyro_peak_ratio: float | None = Field(default=None, ge=0, le=1)
    sensor_sample_count: int | None = Field(default=None, ge=0)
    is_moving: bool | None = None


class TelemetryBatchIn(BaseModel):
    session_id: int
    points: list[TelemetryPointIn] = Field(min_length=1, max_length=5000)


class TelemetryBatchOut(BaseModel):
    received: int
    inserted: int
    duplicates: int
