import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.core.errors import not_found, validation_error
from app.models.customer import Contact, Customer
from app.models.mail import Mail
from app.models.user import User
from app.models.visit import Visit, VisitContact
from app.schemas.mail import MailOut, ManualResponseIn, SendNowIn
from app.services.audit import audit
from app.services.mail_engine import apply_response, mail_blocked_by_c, send_mail
from app.services.scheduler_service import on_hold, run_day
from app.services.settings_service import get_settings
from app.models.enums import sv

router = APIRouter(tags=["mails"])


def _owned_mail(db: Session, user: User, mail_id: uuid.UUID) -> tuple[Mail, VisitContact, Visit]:
    mail = db.get(Mail, mail_id)
    if not mail:
        raise not_found("Mail not found")
    vc = db.get(VisitContact, mail.visit_contact_id)
    visit = db.get(Visit, vc.visit_id)
    if user.role.value == "design" and visit.owner_id != user.id:
        raise not_found("Mail not found")
    return mail, vc, visit


@router.get("/visits/{visit_id}/mails", response_model=list[MailOut])
def list_visit_mails(visit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Mail]:
    visit = db.get(Visit, visit_id)
    if not visit or (user.role.value == "design" and visit.owner_id != user.id):
        raise not_found("Visit not found")
    vc_ids = [vc.id for vc in db.scalars(select(VisitContact).where(VisitContact.visit_id == visit_id))]
    mails = db.scalars(select(Mail).where(Mail.visit_contact_id.in_(vc_ids)).order_by(Mail.mail_number)).all()
    # Link-state needs 4 distinct states in the UI (not sent / sent-not-opened / open till X /
    # expired), and "expired" needs an expiry instant — computed here from settings rather than
    # exposing the admin-only GET /settings to every role that can view a follow-up.
    validity_days = get_settings(db)["link_validity_days"]
    for m in mails:
        m.link_expires_at = (m.first_opened_at + timedelta(days=validity_days)) if m.first_opened_at else None
    return mails


@router.get("/mails/{mail_id}/draft")
def get_mail_draft(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Raw (un-rendered — {placeholder}s left intact) subject/body for the 'review before sending'
    dialog, so staff can tweak the wording for just this one send. Unlike GET /mails/{id}/content
    (which resolves {link} to a fake preview string for display), this keeps {link} as a literal
    token so the real one-time link can still be substituted in at actual send time."""
    from app.services.mail_templates import get_template

    mail, vc, visit = _owned_mail(db, user, mail_id)
    customer = db.get(Customer, visit.customer_id)
    contact = db.get(Contact, vc.contact_id)
    variant = mail.variant or (("ordered" if vc.order_placed else "notordered") if mail.mail_number == 5 else None)
    template = get_template(db, mail.mail_number, variant)
    settings = get_settings(db)
    return {"to_email": contact.email, "cc": settings.get("marketing_cc"), "subject": template.subject, "body": template.body}


@router.post("/mails/{mail_id}/send-now", response_model=MailOut)
def send_now(mail_id: uuid.UUID, payload: SendNowIn | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    mail, vc, visit = _owned_mail(db, user, mail_id)
    if sv(mail.status) != "scheduled":
        raise validation_error("This mail is not awaiting send")
    if on_hold(db, vc.id):
        raise validation_error("Follow-up for this contact is paused — a previous mail bounced")
    customer = db.get(Customer, visit.customer_id)
    settings = get_settings(db)
    if mail_blocked_by_c(vc, mail, customer):
        raise validation_error(f"{customer.name} is Blacklist C — new collection not offered")
    send_mail(db, vc, mail, date.today(), settings,
              subject_override=payload.subject if payload else None, body_override=payload.body if payload else None)
    audit(db, user_id=user.id, action="send_mail_now", entity_type="mail", entity_id=mail.id)
    db.commit()
    return mail


@router.post("/mails/{mail_id}/manual-response", response_model=MailOut)
def manual_response(mail_id: uuid.UUID, payload: ManualResponseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """§7 validation doc: allowed even if the mail is still 'scheduled' (staff can get a phone
    call before the scheduled send date) — recorded as answered out-of-band."""
    mail, vc, visit = _owned_mail(db, user, mail_id)
    has_main_answer = bool(payload.data)
    has_item_feedback = bool(payload.item_feedback) and any((f.sentiment or (f.text and f.text.strip())) for f in payload.item_feedback)
    if not has_main_answer and not has_item_feedback:
        raise validation_error("Answer the main question, or give feedback for at least one item")
    settings = get_settings(db)
    submitted_at = payload.submitted_at or datetime.now(timezone.utc)
    apply_response(
        db, mail, payload.data,
        {"name": payload.by_name, "designation": payload.by_designation, "email": payload.by_email},
        submitted_at, "manual", settings,
        item_feedback=[f.model_dump() for f in payload.item_feedback],
    )
    audit(db, user_id=user.id, action="manual_response", entity_type="mail", entity_id=mail.id)
    db.commit()
    return mail


@router.post("/mails/{mail_id}/resend-link", response_model=MailOut)
def resend_link(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """Staff action for 'Send new link' — supersedes the old token and mints a fresh one with a
    fresh first_opened_at (§7 validation doc)."""
    mail, vc, visit = _owned_mail(db, user, mail_id)
    settings = get_settings(db)
    send_mail(db, vc, mail, date.today(), settings, resend=True)
    mail.requested_new = False
    mail.request_resolved = True
    audit(db, user_id=user.id, action="resend_link", entity_type="mail", entity_id=mail.id)
    db.commit()
    return mail


@router.post("/mails/{mail_id}/mark-reviewed", response_model=MailOut)
def mark_reviewed(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    mail, vc, visit = _owned_mail(db, user, mail_id)
    mail.unreviewed = False
    db.commit()
    return mail


@router.post("/mails/{mail_id}/fix-bounce", response_model=MailOut)
def fix_bounce(mail_id: uuid.UUID, new_email: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """After the contact's email is corrected, resume follow-up: the bounced mail goes back to
    'scheduled' so the next scheduler run (or a manual send) can pick it up again."""
    from app.utils import is_valid_email
    if not is_valid_email(new_email):
        raise validation_error("Enter a valid email")
    mail, vc, visit = _owned_mail(db, user, mail_id)
    if sv(mail.status) != "bounced":
        raise validation_error("This mail has not bounced")
    contact = db.get(Contact, vc.contact_id)
    contact.email = new_email
    mail.status = "scheduled"
    mail.note = "Email fixed — resuming follow-up"
    audit(db, user_id=user.id, action="fix_bounce", entity_type="mail", entity_id=mail.id, detail={"new_email": new_email})
    db.commit()
    return mail


@router.post("/mails/{mail_id}/simulate-bounce", response_model=MailOut)
def simulate_bounce(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """Test/dev helper standing in for a real provider bounce webhook."""
    mail, vc, visit = _owned_mail(db, user, mail_id)
    mail.status = "bounced"
    db.commit()
    return mail


@router.post("/mails/{mail_id}/postpone", response_model=MailOut)
def postpone_mail(mail_id: uuid.UUID, new_due_date: date, reason: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """Staff 'Change date' action. Pinning stops the normal recompute() from overwriting this one
    mail's due date on the next scheduler/response-driven recompute — the same mechanism already
    used to pin Mail 5 after an order lands (mail_engine.derive_outcome)."""
    mail, vc, visit = _owned_mail(db, user, mail_id)
    if sv(mail.status) != "scheduled":
        raise validation_error("Only a scheduled (not yet sent) mail can be postponed")
    if new_due_date <= date.today():
        raise validation_error("Pick a date in the future")
    reason = (reason or "").strip()
    if not reason:
        raise validation_error("A reason is required")
    mail.due_date = new_due_date
    mail.pinned = True
    mail.note = f"Postponed to {new_due_date.isoformat()} — {reason}"
    audit(db, user_id=user.id, action="postpone_mail", entity_type="mail", entity_id=mail.id, detail={"new_due_date": new_due_date.isoformat(), "reason": reason})
    db.commit()
    return mail


@router.post("/mails/{mail_id}/skip", response_model=MailOut)
def skip_mail(mail_id: uuid.UUID, reason: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """Staff 'Don't send' action — a manual skip, distinct from the system's own auto_skip/c_skip
    flags, so the order/closure-driven restore logic in derive_outcome() never silently reopens it."""
    mail, vc, visit = _owned_mail(db, user, mail_id)
    if sv(mail.status) != "scheduled":
        raise validation_error("Only a scheduled (not yet sent) mail can be skipped")
    reason = (reason or "").strip()
    if not reason:
        raise validation_error("A reason is required")
    mail.status = "skipped"
    mail.auto_skip = False
    mail.note = f"Not sent — {reason}"
    audit(db, user_id=user.id, action="skip_mail", entity_type="mail", entity_id=mail.id, detail={"reason": reason})
    db.commit()
    return mail


@router.post("/mails/{mail_id}/unskip", response_model=MailOut)
def unskip_mail(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Mail:
    """Undo a manual skip (or a manual postpone's pin) — puts the mail back under normal scheduling."""
    mail, vc, visit = _owned_mail(db, user, mail_id)
    if sv(mail.status) == "skipped" and not mail.auto_skip and not mail.c_skip:
        mail.status = "scheduled"
        mail.note = "Restored — resuming normal schedule"
    mail.pinned = False
    settings = get_settings(db)
    from app.services.mail_engine import recompute
    recompute(db, vc, settings)
    audit(db, user_id=user.id, action="unskip_mail", entity_type="mail", entity_id=mail.id)
    db.commit()
    return mail


@router.get("/mails/{mail_id}/portal-preview")
def preview_portal(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Staff 'view as customer' preview (the prototype's preview/staff mode, launched from Outbox).
    Returns the exact same payload the customer's own portal page would show, but authenticated as
    staff and by mail_id rather than by token — crucially, it is read-only / non-consuming: unlike
    GET /portal/{token}/open, this never sets Mail.first_opened_at, so looking at it never starts
    or affects the customer's own link-validity countdown."""
    from app.routers.portal import _status_payload

    mail, vc, visit = _owned_mail(db, user, mail_id)
    settings = get_settings(db)
    return _status_payload(db, mail, settings)


@router.get("/mails/{mail_id}/content")
def get_mail_content(mail_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """The prototype's mail-body viewer (App.viewMail). For an already-sent mail, returns the
    exact content that was sent (from Outbox — never re-derived, since the mail's wording could
    have changed since). For a mail still 'scheduled', there is no Outbox row yet, so this renders
    a live preview of what WOULD be sent right now (is_preview: true) — not persisted anywhere."""
    from app.models.misc import Outbox
    from app.services.mail_engine import items_text
    from app.services.mail_templates import get_template, render

    mail, vc, visit = _owned_mail(db, user, mail_id)
    sent = db.scalar(select(Outbox).where(Outbox.mail_id == mail_id).order_by(Outbox.created_at.desc()))
    if sent:
        return {
            "is_preview": False,
            "to_email": sent.to_email,
            "cc": sent.cc,
            "subject": sent.subject,
            "body": sent.body,
            "sent_at": sent.sent_at.isoformat() if sent.sent_at else None,
        }
    customer = db.get(Customer, visit.customer_id)
    contact = db.get(Contact, vc.contact_id)
    settings = get_settings(db)
    variant = mail.variant or (("ordered" if vc.order_placed else "notordered") if mail.mail_number == 5 else None)
    template = get_template(db, mail.mail_number, variant)
    subject, body = render(
        template,
        contact_name=contact.name, customer_name=customer.name, visit_date=visit.date,
        items=items_text(db, vc), link="[link generated when this mail is sent]",
        link_validity_hours=settings["link_validity_days"] * 24,
    )
    return {"is_preview": True, "to_email": contact.email, "cc": settings.get("marketing_cc"), "subject": subject, "body": body, "sent_at": None}


@router.post("/admin/run-scheduler")
def trigger_scheduler(target_date: date | None = None, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    """Manual trigger for the daily job — also wired to run automatically (app/scheduler.py)."""
    result = run_day(db, target_date or date.today())
    audit(db, user_id=admin.id, action="run_scheduler", entity_type="settings", detail=result)
    db.commit()
    return result
