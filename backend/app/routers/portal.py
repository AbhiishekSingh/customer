"""Customer response portal — fully public, token-based, no login (prototype's renderPortal()
and the App.portalOpen/portalRequest/portalSubmit actions in views.js/actions.js). §7/§8 of the
validation doc.

Security notes (none of this is optional — this is the one surface a customer with nothing but an
emailed link can reach):
  - the token is an opaque random 24-byte string (app.core.security.random_token) — never the
    mail/visit id itself, so a guessed or enumerated id gives nothing away;
  - a tampered visit_item_id in item_feedback is rejected (§7: feedback can only be attached to an
    item that actually belongs to this mail's own visit-contact, never an arbitrary item id);
  - resending a link (staff "Send new link" action, or any new send_mail call) marks the previous
    token token_superseded — an already-opened old link must truly stop working, not just show
    stale content;
  - rate limiting is per-token (and per-IP) via the same in-process limiter used for login, since
    this endpoint is unauthenticated and reachable by anyone who has (or guesses at) a link.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import validation_error
from app.models.customer import Contact, Customer
from app.models.fabric import Fabric
from app.models.mail import ItemFeedback, Mail, MailResponse, PastMailToken
from app.models.user import User
from app.models.visit import Visit, VisitContact, VisitItem
from app.schemas.portal import PortalRespondIn
from app.services.audit import audit
from app.services.mail_engine import apply_response, items_text  # noqa: F401 (items_text kept for parity/debug)
from app.services.notify import notify_user
from app.services.rate_limit import ip_is_rate_limited, record_ip_attempt
from app.services.settings_service import get_settings
from app.services.uploads import save_image_upload
from app.utils import is_valid_email

router = APIRouter(prefix="/portal", tags=["portal"])

PORTAL_MAIL_PURPOSE = {
    1: "Feedback on the swatches given",
    2: "How is the testing going?",
    3: "Proto sample made? Fabric quality OK?",
    4: "Did you place an order?",
    "5ordered": "Order status, in-store date and where to buy",
    "5notordered": "Would you like to see the new collection?",
    5: "Order status (if ordered) or new collection invite",
}


def _mail_purpose(mail: Mail) -> str:
    if mail.mail_number == 5 and mail.variant:
        return PORTAL_MAIL_PURPOSE[f"5{mail.variant}"]
    return PORTAL_MAIL_PURPOSE[mail.mail_number]


def _main_value(mail: Mail, data: dict) -> str:
    """Which field counts as 'the' answer for this mail (readResp() in views.js) — used to decide
    whether a submission has actually answered anything."""
    n = mail.mail_number
    if n == 2:
        return data.get("testStatus") or ""
    if n == 3:
        return data.get("proto") or ""
    if n == 4:
        return data.get("orderPlaced") or ""
    if n == 5:
        return (data.get("execStatus") or "") if mail.variant == "ordered" else (data.get("interested") or "")
    return ""  # Mail 1 has no main question of its own — only the per-item feedback block


def _link_expiry(mail: Mail, settings: dict) -> datetime | None:
    if not mail.first_opened_at:
        return None
    return mail.first_opened_at + timedelta(days=settings["link_validity_days"])


def _link_expired(mail: Mail, settings: dict) -> bool:
    exp = _link_expiry(mail, settings)
    return exp is not None and datetime.now(timezone.utc) >= exp


def _get_by_token(db: Session, token: str) -> Mail | None:
    return db.scalar(select(Mail).where(Mail.token == token))


def _token_was_superseded(db: Session, token: str) -> bool:
    return db.scalar(select(PastMailToken.id).where(PastMailToken.token == token)) is not None


def _item_payload(db: Session, item: VisitItem) -> dict:
    fabric = db.get(Fabric, item.fabric_id)
    latest_fb = db.scalar(
        select(ItemFeedback)
        .where(ItemFeedback.visit_item_id == item.id)
        .order_by(ItemFeedback.logged_at.desc())
        .limit(1)
    )
    already = bool(latest_fb and ((latest_fb.text and latest_fb.text.strip()) or latest_fb.sentiment))
    return {
        "visit_item_id": str(item.id),
        "fabric_code": fabric.code,
        "fabric_name": fabric.name,
        "qty": item.qty,
        "swatch_type": item.swatch_type.value,
        "already_has_feedback": already,
        "sentiment": latest_fb.sentiment if already else None,
        "feedback_text": latest_fb.text if already else None,
        "attachment_url": latest_fb.attachment_url if already else None,
    }


def _status_payload(db: Session, mail: Mail, settings: dict) -> dict:
    vc = db.get(VisitContact, mail.visit_contact_id)
    visit = db.get(Visit, vc.visit_id)
    customer = db.get(Customer, visit.customer_id)
    owner = db.get(User, visit.owner_id)
    contact = db.get(Contact, vc.contact_id)
    items = db.scalars(select(VisitItem).where(VisitItem.visit_contact_id == vc.id)).all()
    later_sent = db.scalar(
        select(Mail.id).where(Mail.visit_contact_id == vc.id, Mail.mail_number > mail.mail_number, Mail.status == "sent")
    ) is not None
    latest_resp = db.scalar(
        select(MailResponse).where(MailResponse.mail_id == mail.id).order_by(MailResponse.submitted_at.desc()).limit(1)
    )
    response_count = len(db.scalars(select(MailResponse.id).where(MailResponse.mail_id == mail.id)).all())

    return {
        "state": "ok",
        "opened": mail.first_opened_at is not None,
        "customer_name": customer.name,
        "owner_name": owner.name,
        "visit_date": visit.date.isoformat(),
        "mail_number": mail.mail_number,
        "mail_purpose": _mail_purpose(mail),
        "variant": mail.variant,
        "sent_at": mail.sent_at.isoformat() if mail.sent_at else None,
        "link_validity_hours": settings["link_validity_days"] * 24,
        "link_expiry": _link_expiry(mail, settings).isoformat() if mail.first_opened_at else None,
        "pieces": sum(i.qty for i in items),
        "contact": {"name": contact.name, "designation": contact.designation, "email": contact.email},
        "items": [_item_payload(db, i) for i in items],
        "later_mail_sent": later_sent,
        "latest_response": (
            {
                "data": latest_resp.raw_data,
                "by_name": latest_resp.by_name,
                "by_designation": latest_resp.by_designation,
                "submitted_at": latest_resp.submitted_at.isoformat(),
                "version": response_count,
            }
            if latest_resp else None
        ),
    }


def _rate_limit(request: Request, token: str) -> None:
    key = f"portal:{token}:{request.client.host if request.client else 'unknown'}"
    if ip_is_rate_limited(key):
        raise validation_error("Too many attempts on this link — please try again later")
    record_ip_attempt(key)


@router.get("/{token}")
def get_portal(token: str, request: Request, db: Session = Depends(get_db)) -> dict:
    _rate_limit(request, token)
    mail = _get_by_token(db, token)
    if not mail:
        return {"state": "superseded" if _token_was_superseded(db, token) else "not_found"}
    settings = get_settings(db)
    if _link_expired(mail, settings):
        return {
            "state": "expired",
            "expired_at": _link_expiry(mail, settings).isoformat(),
            "link_validity_hours": settings["link_validity_days"] * 24,
            "requested_new_pending": mail.requested_new and not mail.request_resolved,
        }
    return _status_payload(db, mail, settings)


@router.post("/{token}/open")
def open_portal(token: str, request: Request, db: Session = Depends(get_db)) -> dict:
    """App.portalOpen(): starts the link's validity timer on first view (idempotent — opening an
    already-opened link just returns its current status, never resets the clock)."""
    _rate_limit(request, token)
    mail = _get_by_token(db, token)
    if not mail:
        return {"state": "superseded" if _token_was_superseded(db, token) else "not_found"}
    settings = get_settings(db)
    if _link_expired(mail, settings):
        return {
            "state": "expired",
            "expired_at": _link_expiry(mail, settings).isoformat(),
            "link_validity_hours": settings["link_validity_days"] * 24,
            "requested_new_pending": mail.requested_new and not mail.request_resolved,
        }
    if not mail.first_opened_at:
        mail.first_opened_at = datetime.now(timezone.utc)
        db.commit()
    return _status_payload(db, mail, settings)


@router.post("/{token}/request-new-link")
def request_new_link(token: str, request: Request, db: Session = Depends(get_db)) -> dict:
    """App.portalRequest(): only meaningful once the current link has expired — the customer asks
    the owner (by email, outside this system) for a fresh one."""
    _rate_limit(request, token)
    mail = _get_by_token(db, token)
    if not mail:
        return {"state": "superseded" if _token_was_superseded(db, token) else "not_found"}
    settings = get_settings(db)
    if not _link_expired(mail, settings):
        raise validation_error("This link has not expired — no need to request a new one yet")
    mail.requested_new = True
    mail.request_resolved = False
    vc = db.get(VisitContact, mail.visit_contact_id)
    visit = db.get(Visit, vc.visit_id)
    customer = db.get(Customer, visit.customer_id)
    audit(db, user_id=None, action="Customer requested a new link", entity_type="mail", entity_id=mail.id,
          detail={"mail_number": mail.mail_number, "by": f"Customer ({customer.name})"})
    notify_user(db, visit.owner_id, f"{customer.name} asked for a new link (Mail {mail.mail_number})", f"/visit/{visit.id}")
    db.commit()
    return {
        "state": "expired",
        "expired_at": _link_expiry(mail, settings).isoformat(),
        "link_validity_hours": settings["link_validity_days"] * 24,
        "requested_new_pending": True,
    }


@router.post("/{token}/respond")
def respond(token: str, payload: PortalRespondIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """App.portalSubmit(): records (or edits) the customer's reply. Re-validated here exactly as
    the prototype did client-side, since nothing from a public, unauthenticated endpoint can be
    trusted to have been validated already."""
    _rate_limit(request, token)
    mail = _get_by_token(db, token)
    if not mail:
        if _token_was_superseded(db, token):
            raise validation_error("A newer link was sent — please use the most recent email.")
        raise validation_error("This link is not valid. Please use the link from your latest email.")
    settings = get_settings(db)
    if _link_expired(mail, settings):
        raise validation_error("This link has expired. Request a new one and your representative will send it.")

    vc = db.get(VisitContact, mail.visit_contact_id)
    item_ids = {i.id for i in db.scalars(select(VisitItem).where(VisitItem.visit_contact_id == vc.id))}

    by_name = (payload.by_name or "").strip()
    by_designation = (payload.by_designation or "").strip()
    by_email = (payload.by_email or "").strip()

    # tamper check: every visit_item_id submitted must actually belong to THIS visit-contact —
    # never trust a client-supplied id enough to attach feedback to someone else's item.
    for fb in payload.item_feedback:
        if fb.visit_item_id not in item_ids:
            raise validation_error("One of the submitted items does not belong to this follow-up")

    data = {k: v for k, v in (payload.data or {}).items() if v not in ("", None, [])}
    main = _main_value(mail, data)
    not_proceeding = bool(data.get("notProceeding"))
    any_item_fb = any((fb.sentiment or (fb.text and fb.text.strip())) for fb in payload.item_feedback)

    if (not main and not not_proceeding and not any_item_fb) or not by_name or not by_designation:
        raise validation_error(
            "Please give feedback for at least one item (or answer the question above), and enter your name and designation."
        )
    if by_email and not is_valid_email(by_email):
        raise validation_error("That email address doesn't look right.")

    # open the link implicitly if the customer somehow posts a response before the explicit
    # /open call (defensive — the API should never crash on a client that skips a step).
    if not mail.first_opened_at:
        mail.first_opened_at = datetime.now(timezone.utc)

    if not_proceeding:
        data["notProceeding"] = True

    apply_response(
        db, mail, data,
        {"name": by_name, "designation": by_designation, "email": by_email or None},
        datetime.now(timezone.utc), "portal", settings,
        item_feedback=[
            {"visit_item_id": fb.visit_item_id, "sentiment": fb.sentiment, "text": fb.text, "attachment_url": fb.attachment_url}
            for fb in payload.item_feedback
        ],
    )

    visit = db.get(Visit, vc.visit_id)
    customer = db.get(Customer, visit.customer_id)
    summary = main or ("Not proceeding" if not_proceeding else "") or "Item feedback recorded"
    audit(db, user_id=None, action=f"Customer submitted a reply to Mail {mail.mail_number}", entity_type="mail",
          entity_id=mail.id, detail={"summary": summary, "by": f"Customer ({by_name})"})
    db.commit()
    return _status_payload(db, mail, settings)


@router.post("/{token}/upload")
async def upload_attachment(token: str, request: Request, db: Session = Depends(get_db), file: UploadFile = File(...)) -> dict:
    """Lets the customer attach a photo (e.g. of the swatch/prototype) from their own device
    instead of having to paste a URL to an image hosted somewhere else. Same token/expiry/rate-limit
    checks as every other public portal action — this is still an unauthenticated endpoint."""
    _rate_limit(request, token)
    mail = _get_by_token(db, token)
    if not mail:
        raise validation_error("This link is not valid. Please use the link from your latest email.")
    settings = get_settings(db)
    if _link_expired(mail, settings):
        raise validation_error("This link has expired. Request a new one and your representative will send it.")
    url = await save_image_upload(file)
    return {"url": url}
