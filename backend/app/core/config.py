from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    app_name: str = "Sistema de Monitoreo Inteligente de Rondas"

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
    impossible_speed_mps: float = 3.5
    impossible_speed_min_duration_s: int = 30
    scan_max_fix_age_s: int = 30
    scan_max_accuracy_m: float = 50.0
    performance_decline_ratio: float = 0.3
    # Severity banding for fraudulent scans, as multiples of the checkpoint radius
    fraud_severity_medium_ratio: float = 2.0
    fraud_severity_high_ratio: float = 5.0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
