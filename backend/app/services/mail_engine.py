"""The follow-up mail engine — a faithful port of the prototype's core.js scheduling/response logic
(createMails, recompute, sendMail, applyResponse, deriveOutcome, runDay). See §6/§7 of the workflow
doc and §6/§7 of the validation doc for the business rules this encodes.
"""
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import random_token
from app.models.customer import Contact, Customer
from app.models.fabric import Fabric
from app.models.mail import ItemFeedback, Mail, MailResponse, PastMailToken
from app.core.config import settings as app_config
from app.models.misc import Outbox
from app.models.visit import Visit, VisitContact, VisitItem
from app.services.email_sender import EmailSendError, send_email
from app.services.mail_templates import get_template, render, validate_template
from app.services.notify import notify_managers, notify_user
from app.services.settings_service import next_working_day
from app.models.enums import sv


class MailSendFailed(Exception):
    """Raised by send_mail() when SMTP is configured but the actual send failed. mail.status
    is already set to 'send_failed' and the Outbox row recorded before this is raised, so the
    attempt isn't lost — callers just decide how loudly to surface it (see routers/mails.py
    for the manual "Send now" path, and scheduler_service.run_day for the batch path, which
    catches this per-mail so one bad address doesn't stop the rest of the day's mails)."""

MAIL_COUNT = 5


def interval(n: int, settings: dict) -> int:
    return settings["intervals"][n - 1]


def recompute(db: Session, vc: VisitContact, settings: dict) -> None:
    """SCHEDULE RULE: Mail 1 = visit date + interval(1); each later mail is counted from the
    PREVIOUS mail's own scheduled base date, not from when it was actually sent. A weekend/holiday
    only rolls that one mail's due date forward — it never cascades into later mails (those move
    only when a mail is pinned, e.g. mail 5 after an order)."""
    visit = db.get(Visit, vc.visit_id)
    mails = sorted(db.scalars(select(Mail).where(Mail.visit_contact_id == vc.id)), key=lambda m: m.mail_number)
    prev = visit.date
    for m in mails:
        if sv(m.status) == "scheduled" and not m.pinned:
            m.base_date = prev + __import__("datetime").timedelta(days=interval(m.mail_number, settings))
            m.due_date = next_working_day(m.base_date, settings)
        prev = m.base_date or m.due_date or prev


def create_mails(db: Session, vc: VisitContact, settings: dict) -> list[Mail]:
    mails = []
    for n in range(1, MAIL_COUNT + 1):
        m = Mail(visit_contact_id=vc.id, mail_number=n, base_date=date.today(), due_date=date.today())
        db.add(m)
        mails.append(m)
    db.flush()
    recompute(db, vc, settings)
    return mails


# ---------- item-feedback-done / order / closure derivation ----------

def item_feedback_given(db: Session, visit_item_id: uuid.UUID) -> bool:
    latest = db.scalar(
        select(ItemFeedback)
        .where(ItemFeedback.visit_item_id == visit_item_id)
        .order_by(ItemFeedback.logged_at.desc())
        .limit(1)
    )
    if not latest:
        return False
    return bool((latest.text and latest.text.strip()) or latest.sentiment)


def items_all_done(db: Session, vc: VisitContact) -> bool:
    items = db.scalars(select(VisitItem).where(VisitItem.visit_contact_id == vc.id)).all()
    if not items:
        return False
    return all(item_feedback_given(db, it.id) for it in items)


def derive_outcome(db: Session, vc: VisitContact, settings: dict) -> None:
    mails = sorted(db.scalars(select(Mail).where(Mail.visit_contact_id == vc.id)), key=lambda m: m.mail_number)
    order_placed, order_date_, order_mail, order_fabrics = False, None, None, None
    closure_type, closure_mail = None, None

    # A staff-recorded manual order (phone call etc.) always wins — checked before any mail
    # response, matching the prototype's `if (v.manualOrder) order = {...}` precedence.
    if vc.manual_order_date:
        order_placed, order_date_, order_mail, order_fabrics = True, vc.manual_order_date, vc.manual_order_after_mail, vc.manual_order_fabrics

    for m in mails:
        resp = db.scalar(select(MailResponse).where(MailResponse.mail_id == m.id).order_by(MailResponse.submitted_at.desc()).limit(1))
        if not resp:
            continue
        data = resp.raw_data or {}
        if data.get("orderPlaced") == "yes" and not order_placed:
            order_placed, order_date_, order_mail = True, resp.submitted_at.date(), m.mail_number
            order_fabrics = data.get("orderFabrics") or None
        if data.get("notProceeding") and not closure_type:
            closure_type, closure_mail = "not_proceeding", m.mail_number

    vc.order_placed = order_placed
    vc.order_date = order_date_
    vc.order_mail_number = order_mail
    vc.order_fabrics = order_fabrics
    vc.closure_type = None if order_placed else closure_type
    vc.closure_mail_number = None if order_placed else closure_mail

    items_done = items_all_done(db, vc)
    stop_at = 0 if items_done else (order_mail if order_placed else (closure_mail if closure_type else None))

    later_non_scheduled_exists = False
    for x in sorted(mails, key=lambda m: m.mail_number, reverse=True):
        if x.mail_number == 5:
            continue
        should_skip = stop_at is not None and x.mail_number > stop_at
        if should_skip and sv(x.status) == "scheduled":
            x.status = "skipped"
            x.auto_skip = True
            x.note = "Order placed — not needed" if order_placed else ("Customer not proceeding" if closure_type else "Feedback received for all items — not needed")
        elif not should_skip and x.auto_skip and sv(x.status) == "skipped" and not later_non_scheduled_exists:
            x.status = "scheduled"
            x.auto_skip = False
            x.note = "Restored — customer changed their answer"
        if sv(x.status) not in ("scheduled",) and not x.auto_skip:
            later_non_scheduled_exists = True

    m5 = next((m for m in mails if m.mail_number == 5), None)
    if m5 and sv(m5.status) == "scheduled":
        if order_placed:
            m5.variant = "ordered"
            m5.base_date = order_date_ + __import__("datetime").timedelta(days=settings.get("mail5_after_order_days", 30))
            m5.due_date = next_working_day(m5.base_date, settings)
            m5.pinned = True
        elif m5.pinned:
            m5.variant = None
            m5.pinned = False
    elif m5 and sv(m5.status) == "sent" and m5.variant == "ordered" and not order_placed:
        m5.note = "Sent as 5A; the order was later withdrawn by the customer"

    recompute(db, vc, settings)


# ---------- sending ----------

MAIL_PURPOSE = {
    1: "Feedback on the swatches given",
    2: "Testing status",
    3: "Prototype made / quality check",
    4: "Order placed?",
    5: "Execution status (in-store date, where to buy)",
}


def mail_blocked_by_c(vc: VisitContact, mail: Mail, customer: Customer) -> bool:
    """§6/§7: Blacklist C blocks only the 'new collection' Mail 5 preview path — not an
    already-placed order's own execution-status follow-up."""
    return mail.mail_number == 5 and not vc.order_placed and customer.blacklist_cat == "C"


def items_text(db: Session, vc: VisitContact) -> str:
    items = db.scalars(select(VisitItem).where(VisitItem.visit_contact_id == vc.id)).all()
    lines = []
    for it in items:
        fabric = db.get(Fabric, it.fabric_id)
        lines.append(f"  • {fabric.code} — {fabric.name} — {it.qty} {it.swatch_type.value}")
    return "\n".join(lines)


def send_mail(db: Session, vc: VisitContact, mail: Mail, send_date: date, settings: dict, resend: bool = False,
              subject_override: str | None = None, body_override: str | None = None, extra_cc: str | None = None) -> Mail:
    if mail.mail_number == 5 and sv(mail.status) == "scheduled":
        mail.variant = "ordered" if vc.order_placed else "notordered"
    if mail.token:
        # superseding the old token, not deleting it — an already-opened old link must truly stop
        # working, and still resolve to a clear "a newer link was sent" message rather than
        # looking unrecognised. Mail.token only ever holds the current live token, so the old
        # value is archived in PastMailToken before being overwritten.
        db.add(PastMailToken(mail_id=mail.id, token=mail.token))
    mail.token = random_token(24)
    mail.first_opened_at = None
    mail.requested_new = False
    mail.request_resolved = False
    if not mail.sent_at or resend:
        mail.sent_at = mail.sent_at or send_date
    mail.status = "sent"

    visit = db.get(Visit, vc.visit_id)
    customer = db.get(Customer, visit.customer_id)
    contact = db.get(Contact, vc.contact_id)
    if subject_override is not None or body_override is not None:
        # staff tweaked the wording for just this one send, in the "review before sending" dialog
        # — re-validated exactly like a saved template (still must carry exactly one {link}),
        # since this text was typed by a person, not trusted sight-unseen.
        template = SimpleNamespace(
            subject=subject_override if subject_override is not None else get_template(db, mail.mail_number, mail.variant).subject,
            body=body_override if body_override is not None else get_template(db, mail.mail_number, mail.variant).body,
        )
        validate_template(template.subject, template.body)
    else:
        template = get_template(db, mail.mail_number, mail.variant)
    link = f"/portal/{mail.token}"
    subject, body = render(
        template,
        contact_name=contact.name, customer_name=customer.name, visit_date=visit.date,
        items=items_text(db, vc), link=link, link_validity_hours=settings["link_validity_days"] * 24,
    )
    # Outbox.body / the "View" preview keep the relative /portal/<token> link as before (unchanged
    # behavior). The actual outbound email needs an absolute, clickable URL though — a bare
    # "/portal/abc123" is useless once it's sitting in someone's inbox instead of this app's UI.
    email_body = body.replace(link, f"{app_config.FRONTEND_URL}{link}")

    # Extra recipient is additive — it rides along as an extra cc on top of the configured
    # marketing cc, never replacing the customer's own To: address or the marketing cc.
    cc_parts = [c for c in [settings.get("marketing_cc"), extra_cc] if c]
    cc = ", ".join(cc_parts) if cc_parts else None

    send_error: str | None = None
    try:
        send_email(to_email=contact.email or "", subject=subject, body=email_body, cc=cc)
    except EmailSendError as exc:
        send_error = str(exc)
        mail.status = "send_failed"

    db.add(Outbox(mail_id=mail.id, to_email=contact.email or "", cc=cc, subject=subject,
                   body=body, status="send_failed" if send_error else "sent", sent_at=send_date,
                   customer_id=customer.id))
    db.flush()
    if send_error:
        raise MailSendFailed(send_error)
    recompute(db, vc, settings)
    return mail


def apply_response(db: Session, mail: Mail, data: dict, by: dict, submitted_at: datetime, source: str, settings: dict,
                    item_feedback: list[dict] | None = None) -> MailResponse:
    """Port of core.js applyResponse(): records the response, flips a bounced mail back to 'sent'
    (a reply proves the mail arrived), re-derives order/closure state, and raises the same staff
    notifications the prototype did (new/edited response, order placed/retracted, mail-5 interest).
    §6/§7 of the validation doc.

    Not yet ported here (tracked separately, not silently dropped): the prototype's manualOrder
    mismatch warning (manual phone-call order entry has its own backend task) and the
    evaluateBlacklists() call (wired once the Blacklist governance task builds that evaluator)."""
    is_first_response = db.scalar(select(MailResponse.id).where(MailResponse.mail_id == mail.id)) is None
    vc = db.get(VisitContact, mail.visit_contact_id)
    had_order_before = vc.order_placed

    resp = MailResponse(mail_id=mail.id, submitted_at=submitted_at, source=source, raw_data=data,
                         by_name=by.get("name"), by_designation=by.get("designation"), by_email=by.get("email"))
    db.add(resp)
    db.flush()
    for fb in item_feedback or []:
        db.add(ItemFeedback(mail_response_id=resp.id, visit_item_id=fb["visit_item_id"],
                             sentiment=fb.get("sentiment"), text=fb.get("text"), attachment_url=fb.get("attachment_url"),
                             logged_at=submitted_at))
    mail.unreviewed = True
    if sv(mail.status) == "bounced":
        mail.status = "sent"  # a reply proves the mail arrived
    db.flush()

    visit = db.get(Visit, vc.visit_id)
    customer = db.get(Customer, visit.customer_id)

    by_suffix = f" (by {by['name']})" if by.get("name") else ""
    notify_user(db, visit.owner_id,
                f"{'New response' if is_first_response else 'Response edited'} from {customer.name} to Mail {mail.mail_number}{by_suffix}",
                f"/visit/{visit.id}")

    if vc.manual_order_date and (data.get("orderPlaced") == "no" or data.get("notProceeding")):
        why = "not going ahead" if data.get("notProceeding") else "no order yet"
        notify_user(db, visit.owner_id,
                    f"{customer.name} answered \"{why}\" but an order was recorded by {vc.manual_order_by} — please check and undo the order if it was a mistake",
                    f"/visit/{visit.id}")

    derive_outcome(db, vc, settings)

    if not had_order_before and vc.order_placed:
        notify_user(db, visit.owner_id, f"{customer.name} placed an order in the selected fabrics", f"/visit/{visit.id}")
    elif had_order_before and not vc.order_placed:
        notify_user(db, visit.owner_id, f"{customer.name} changed their answer — order no longer recorded; skipped mails restored", f"/visit/{visit.id}")

    if mail.mail_number == 5 and data.get("interested") == "yes" and is_first_response:
        preferred = f" (preferred {data['preferredDate']})" if data.get("preferredDate") else ""
        notify_user(db, visit.owner_id, f"{customer.name} wants to see the new collection{preferred} — contact them to fix the presentation", f"/customer/{customer.id}")
        notify_managers(db, f"{customer.name} is interested in the new collection", f"/customer/{customer.id}")

    # Local import to avoid a circular import (blacklist_eval -> scheduler_service -> mail_engine).
    # Prototype's applyResponse(): `if (!SEEDING) evaluateBlacklists(...)` — every response can
    # change whether a blacklist rule now holds or no longer holds.
    from app.services.blacklist_eval import evaluate_blacklists
    evaluate_blacklists(db, max(date.today(), submitted_at.date()))

    return resp
