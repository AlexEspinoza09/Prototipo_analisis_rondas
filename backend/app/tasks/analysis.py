import logging

from app.core.db import SessionLocal
from app.services.analysis_service import analyze_guards_performance, analyze_session
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.analyze_session")
def analyze_session_task(session_id: int) -> int:
    """Rules 3, 5, 6 and 7 (route, timing, sensors, GPS quality), enqueued on session end."""
    db = SessionLocal()
    try:
        anomalies = analyze_session(db, session_id)
        logger.info("Analysis for session %s created %d anomalies", session_id, len(anomalies))
        return len(anomalies)
    finally:
        db.close()


@celery_app.task(name="app.tasks.nightly_performance_analysis")
def nightly_performance_analysis_task() -> int:
    """Rule 4: per-guard performance decline, scheduled nightly by Beat."""
    db = SessionLocal()
    try:
        anomalies = analyze_guards_performance(db)
        logger.info("Nightly performance analysis created %d anomalies", len(anomalies))
        return len(anomalies)
    finally:
        db.close()
