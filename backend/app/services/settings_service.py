from datetime import date

from sqlalchemy.orm import Session

from app.models.misc import SystemSettings

DEFAULTS = {
    "intervals": [7, 45, 60, 120, 60],
    "weekend_days": [0],  # 0 = Sunday, matching the prototype's isWorking()
    "holidays": [],  # [{"date": "YYYY-MM-DD", "name": "..."}]
    "link_validity_days": 2,
    # Mail 5 is special: once an order is placed it is no longer "days after Mail 4" (that's
    # `intervals[4]`, used only when no order has been placed yet) — it's re-pinned to fire this
    # many days after the ORDER DATE instead, to check on order/delivery status. See mail_engine.py
    # derive_outcome().
    "mail5_after_order_days": 30,
    "auto_send": True,
    "b_grace_days": 30,
    "senior_mgmt_email": "senior.management@example.com",
    "marketing_head_email": "marketing.head@example.com",
    "marketing_cc": "marketing.team@example.com",
    "report_frequency": "weekly",
    "report_recipients": "senior.management@example.com",
}


def get_settings(db: Session) -> dict:
    row = db.query(SystemSettings).first()
    if not row:
        row = SystemSettings(data=DEFAULTS.copy())
        db.add(row)
        db.commit()
    merged = {**DEFAULTS, **row.data}
    return merged


def update_settings(db: Session, patch: dict) -> dict:
    row = db.query(SystemSettings).first()
    if not row:
        row = SystemSettings(data=DEFAULTS.copy())
        db.add(row)
        db.flush()
    row.data = {**row.data, **patch}
    db.commit()
    return {**DEFAULTS, **row.data}


def is_working_day(d: date, settings: dict) -> bool:
    if d.weekday() == 6 and 0 in settings["weekend_days"]:
        # Python Monday=0..Sunday=6; prototype's dow uses JS convention Sunday=0..Saturday=6.
        pass
    dow_js = (d.weekday() + 1) % 7  # convert Python Monday=0 to JS Sunday=0 convention
    if dow_js in settings["weekend_days"]:
        return False
    iso = d.isoformat()
    if any(h["date"] == iso for h in settings["holidays"]):
        return False
    return True


def next_working_day(d: date, settings: dict) -> date:
    from datetime import timedelta
    guard = 0
    while not is_working_day(d, settings) and guard < 30:
        d = d + timedelta(days=1)
        guard += 1
    return d
