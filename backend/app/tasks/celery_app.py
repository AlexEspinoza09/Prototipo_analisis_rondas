from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "rondas",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.analysis"],
)

celery_app.conf.update(
    timezone="America/Guayaquil",
    enable_utc=True,
    task_track_started=True,
)

celery_app.conf.beat_schedule = {
    "nightly-performance-analysis": {
        "task": "app.tasks.nightly_performance_analysis",
        "schedule": crontab(hour=3, minute=0),
    },
}


@celery_app.task(name="app.tasks.ping")
def ping() -> str:
    """Smoke-test task to verify the worker is wired to Redis."""
    return "pong"
