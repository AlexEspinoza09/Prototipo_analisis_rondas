from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "rondas",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    timezone="America/Guayaquil",
    enable_utc=True,
    task_track_started=True,
)


@celery_app.task(name="app.tasks.ping")
def ping() -> str:
    """Smoke-test task to verify the worker is wired to Redis."""
    return "pong"
