"""The daily scheduler job — prototype's runDay(). Idempotent per calendar day (§7 of the
validation doc: running it twice for the same date must not double-send)."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.mail import Mail
from app.models.misc import SystemSettings
from app.models.visit import Visit, VisitContact
from app.services.mail_engine import MailSendFailed, mail_blocked_by_c, send_mail
from app.services.settings_service import get_settings
from app.models.enums import sv


def on_hold(db: Session, vc_id) -> bool:
    return db.scalar(select(Mail).where(Mail.visit_contact_id == vc_id, Mail.status == "bounced")) is not None


def run_day(db: Session, target_date: date) -> dict:
    row = db.query(SystemSettings).first()
    last_run = (row.data or {}).get("last_run_date") if row else None
    if last_run == target_date.isoformat():
        return {"skipped": True, "reason": "already ran for this date"}

    settings = get_settings(db)
    sent, skipped_c, held, failed = 0, 0, 0, 0

    due_mails = db.scalars(
        select(Mail).where(Mail.status == "scheduled", Mail.due_date <= target_date)
    ).all()
    for mail in due_mails:
        vc = db.get(VisitContact, mail.visit_contact_id)
        if on_hold(db, vc.id):
            held += 1
            continue
        if not settings["auto_send"]:
            continue  # stays 'scheduled' — surfaces as a to-do for manual "Approve & send"
        visit = db.get(Visit, vc.visit_id)
        customer = db.get(Customer, visit.customer_id)
        if mail_blocked_by_c(vc, mail, customer):
            mail.status = "skipped"
            mail.auto_skip = False  # distinct from the order/closure auto-skip — this is the Blacklist-C gate
            mail.c_skip = True
            mail.note = "Blacklist C — new collection not offered"
            skipped_c += 1
            continue
        try:
            send_mail(db, vc, mail, target_date, settings)
            sent += 1
        except MailSendFailed:
            # mail.status is already 'send_failed' and staged on the session (see mail_engine) —
            # one bad/unreachable address must not stop the rest of today's mails from going out.
            failed += 1

    if not row:
        from app.models.misc import SystemSettings as _S
        row = _S(data={})
        db.add(row)
        db.flush()
    row.data = {**row.data, "last_run_date": target_date.isoformat()}

    # Local import: blacklist_eval imports on_hold from this module, so importing it at module
    # level here would be circular. §6 validation doc / prototype's runDay(): evaluateBlacklists()
    # runs right after the day's mails go out.
    from app.services.blacklist_eval import evaluate_blacklists
    bl = evaluate_blacklists(db, target_date)

    db.commit()
    return {"skipped": False, "sent": sent, "failed": failed, "blacklist_c_skipped": skipped_c, "held_for_bounce": held, "blacklist_eval": bl}
