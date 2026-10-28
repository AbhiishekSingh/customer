from datetime import date, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.database import SessionLocal
from app.services.scheduler_service import run_day

# Explicit UTC avoids tzlocal trying (and failing) to resolve the container's TZ env var
# (e.g. "Asia/Calcutta", not a valid IANA zoneinfo key) into a local timezone.
_scheduler = BackgroundScheduler(timezone=timezone.utc)


def _run_daily_job() -> None:
    db = SessionLocal()
    try:
        run_day(db, date.today())
    finally:
        db.close()


def start_scheduler() -> None:
    if not _scheduler.running:
        _scheduler.add_job(_run_daily_job, "cron", hour=2, minute=0, id="daily_mail_job", replace_existing=True)
        _scheduler.start()


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
