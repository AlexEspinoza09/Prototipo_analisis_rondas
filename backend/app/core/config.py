from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    app_name: str = "Monitoreo Inteligente de Rondas de Seguridad"

    database_url: str = "postgresql+psycopg2://rondas:rondas@localhost:5432/rondas"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str = "change-me-in-dev-too"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    # Business-rule thresholds (configurable, never hardcoded in services)
    walk_accel_threshold_mps2: float = 1.2
    inactivity_window_min: int = 5
    inactivity_still_ratio: float = 0.8
    route_frechet_threshold_m: float = 100.0
    # Impossible speed depends on the route's patrol mode (on foot vs. vehicle)
    impossible_speed_mps: float = 3.5
    impossible_speed_vehicle_mps: float = 16.7
    impossible_speed_min_duration_s: int = 30
    # Vehicle patrols: a scan is only "inactive" if the GPS also barely moved
    inactivity_vehicle_min_displacement_m: float = 50.0
    # Telemetry recorded this long before the session started is a stale cached
    # fix (Android hands one over when tracking begins) and is ignored.
    telemetry_max_before_start_s: int = 60
    scan_max_fix_age_s: int = 30
    scan_max_accuracy_m: float = 50.0
    performance_decline_ratio: float = 0.3

    # Rule 5: timing between checkpoints, as ratios of actual vs. expected time
    segment_fast_ratio: float = 0.5
    segment_slow_ratio: float = 2.0
    # Ignore timing differences smaller than this (absorbs short-segment noise)
    segment_min_delta_min: float = 2.0
    round_short_ratio: float = 0.5
    round_long_ratio: float = 1.5

    # Rule 6: GPS moving while the phone's sensors say it is lying still
    static_accel_std_mps2: float = 0.05
    static_gyro_rad_s: float = 0.03
    sensor_mismatch_min_speed_mps: float = 0.8
    sensor_mismatch_min_duration_s: int = 60

    # Rule 7: GPS signal quality
    telemetry_gap_s: int = 120
    gps_jump_min_distance_m: float = 100.0
    # A jump is an instantaneous hop faster than this multiple of the speed limit
    gps_jump_speed_factor: float = 2.0
    # Severity banding for fraudulent scans, as multiples of the checkpoint radius
    fraud_severity_medium_ratio: float = 2.0
    fraud_severity_high_ratio: float = 5.0
    # Projected SRID used for Fréchet distance (UTM 17S covers mainland Ecuador)
    projection_srid: int = 32717

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
