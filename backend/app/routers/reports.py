"""Outbox (sent-email log), the Activity log, and management Reports — §9/§10 of the validation
doc and the workflow doc. All three are read-only: the activity log in particular has no
update/delete endpoint anywhere in this API (append-only, §10)."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_manager_up
from app.models.customer import Customer
from app.models.mail import Mail
from app.models.misc import AuditLog, Outbox
from app.models.user import User
from app.models.visit import Visit, VisitContact
from app.services.reports import filtered_visit_contacts, report_data

router = APIRouter(tags=["reports"])


def _outbox_type(entry: Outbox) -> str:
    if entry.mail_id:
        return "followup"
    if entry.customer_id:
        return "intimation"
    return "report"


@router.get("/outbox")
def list_outbox(
    type: str | None = Query(None, pattern="^(followup|intimation|report)$"),
    bounced_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    entries = db.scalars(select(Outbox).order_by(Outbox.sent_at.desc(), Outbox.created_at.desc())).all()

    def _visible(e: Outbox) -> bool:
        if user.role.value != "design":
            return True
        if e.mail_id:
            mail = db.get(Mail, e.mail_id)
            vc = db.get(VisitContact, mail.visit_contact_id) if mail else None
            visit = db.get(Visit, vc.visit_id) if vc else None
            return bool(visit and visit.owner_id == user.id)
        if e.customer_id:
            customer = db.get(Customer, e.customer_id)
            return bool(customer and customer.owner_id == user.id)
        return False  # management-report mails go to a distribution list, not any one owner

    out = []
    for e in entries:
        if not _visible(e):
            continue
        etype = _outbox_type(e)
        if type and etype != type:
            continue
        if bounced_only and e.status.value != "bounced":
            continue
        company = None
        if e.customer_id:
            c = db.get(Customer, e.customer_id)
            company = c.name if c else None
        elif e.mail_id:
            mail = db.get(Mail, e.mail_id)
            vc = db.get(VisitContact, mail.visit_contact_id) if mail else None
            visit = db.get(Visit, vc.visit_id) if vc else None
            c = db.get(Customer, visit.customer_id) if visit else None
            company = c.name if c else None
        out.append({
            # created_at (a real timezone-aware timestamp set at the moment this email was sent)
            # is used here, not sent_at — sent_at is date-only (no time-of-day at all), so every
            # row used to render as the same fake midnight-UTC time once converted to local time.
            "id": str(e.id), "date": e.created_at.isoformat() if e.created_at else (e.sent_at.isoformat() if e.sent_at else None), "company": company,
            "to": e.to_email, "cc": e.cc, "subject": e.subject, "type": etype,
            "delivered": e.status.value != "bounced",
            "mail_id": str(e.mail_id) if e.mail_id else None,
        })
    return out


@router.get("/outbox/{outbox_id}")
def get_outbox_entry(outbox_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Full body of one sent email — the staff-facing 'view as customer' preview. Non-consuming:
    unlike the real portal link, opening this never starts or affects the customer's own link timer."""
    from app.core.errors import forbidden, not_found
    e = db.get(Outbox, outbox_id)
    if not e:
        raise not_found("Outbox entry not found")
    if user.role.value == "design":
        visible = False
        if e.mail_id:
            mail = db.get(Mail, e.mail_id)
            vc = db.get(VisitContact, mail.visit_contact_id) if mail else None
            visit = db.get(Visit, vc.visit_id) if vc else None
            visible = bool(visit and visit.owner_id == user.id)
        elif e.customer_id:
            c = db.get(Customer, e.customer_id)
            visible = bool(c and c.owner_id == user.id)
        if not visible:
            raise forbidden("Not allowed")
    return {
        "id": str(e.id), "date": e.created_at.isoformat() if e.created_at else (e.sent_at.isoformat() if e.sent_at else None), "to": e.to_email,
        "cc": e.cc, "subject": e.subject, "body": e.body, "type": _outbox_type(e),
        "delivered": e.status.value != "bounced",
    }


def _resolve_activity_target(db: Session, entity_type: str | None, entity_id) -> tuple[str | None, str | None]:
    """Best-effort (customer_name, link) for one audit-log row, so the Activity log can show a
    resolved Customer column and make rows clickable without the frontend re-deriving this chain
    itself. Falls back to (None, None) for master-data rows that have no customer or own page."""
    if not entity_type or not entity_id:
        return None, None
    from app.models.customer import Contact, Customer
    from app.models.fabric import Fabric
    from app.models.mail import Mail
    from app.models.visit import Visit, VisitContact

    try:
        if entity_type == "customer":
            c = db.get(Customer, entity_id)
            return (c.name if c else None), (f"/customers/{entity_id}" if c else None)
        if entity_type == "contact":
            ct = db.get(Contact, entity_id)
            if not ct:
                return None, None
            c = db.get(Customer, ct.customer_id)
            return (c.name if c else None), f"/customers/{ct.customer_id}"
        if entity_type in ("blacklist_event", "exception"):
            # both tables carry customer_id directly
            from app.models.blacklist import BlacklistEvent, Exception_
            model = BlacklistEvent if entity_type == "blacklist_event" else Exception_
            row = db.get(model, entity_id)
            if not row:
                return None, None
            c = db.get(Customer, row.customer_id)
            return (c.name if c else None), f"/customers/{row.customer_id}"
        if entity_type == "visit":
            v = db.get(Visit, entity_id)
            if not v:
                return None, None
            c = db.get(Customer, v.customer_id)
            return (c.name if c else None), f"/presentation/{entity_id}"
        if entity_type == "visit_contact":
            vc = db.get(VisitContact, entity_id)
            if not vc:
                return None, None
            v = db.get(Visit, vc.visit_id)
            c = db.get(Customer, v.customer_id) if v else None
            return (c.name if c else None), f"/visit/{vc.visit_id}/{entity_id}"
        if entity_type == "mail":
            m = db.get(Mail, entity_id)
            if not m:
                return None, None
            vc = db.get(VisitContact, m.visit_contact_id)
            v = db.get(Visit, vc.visit_id) if vc else None
            c = db.get(Customer, v.customer_id) if v else None
            return (c.name if c else None), (f"/visit/{v.id}/{vc.id}" if v and vc else None)
        if entity_type == "fabric":
            f = db.get(Fabric, entity_id)
            return None, (f"/items" if f else None)
        if entity_type == "user":
            return None, "/users"
    except Exception:
        return None, None
    return None, None


@router.get("/activity")
def list_activity(
    limit: int = Query(200, le=1000),
    entity_type: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_up),
) -> list[dict]:
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if entity_type:
        q = select(AuditLog).where(AuditLog.entity_type == entity_type).order_by(AuditLog.created_at.desc()).limit(limit)
    rows = db.scalars(q).all()
    out = []
    for r in rows:
        by = "System"
        if r.user_id:
            u = db.get(User, r.user_id)
            by = u.name if u else "Unknown"
        customer_name, link = _resolve_activity_target(db, r.entity_type, r.entity_id)
        out.append({
            "id": str(r.id), "date": r.created_at.isoformat(), "by": by, "action": r.action,
            "entity_type": r.entity_type, "entity_id": str(r.entity_id) if r.entity_id else None, "detail": r.detail,
            "customer": customer_name, "link": link,
        })
    return out


@router.get("/reports/summary")
def reports_summary(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    owner_id: uuid.UUID | None = Query(None, alias="owner"),
    customer_category: str | None = Query(None, alias="category"),
    season: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_up),
) -> dict:
    vcs = filtered_visit_contacts(db, date_from=date_from, date_to=date_to, owner_id=owner_id,
                                   customer_category=customer_category, season=season)
    scope_all = not any([date_from, date_to, owner_id, customer_category, season])
    data = report_data(db, vcs, date.today(), scope_all_customers=scope_all)
    return {"as_of": date.today().isoformat(), **data}


@router.post("/reports/email-now")
def email_report_now(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    owner_id: uuid.UUID | None = Query(None, alias="owner"),
    customer_category: str | None = Query(None, alias="category"),
    season: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_up),
) -> dict:
    """"Email report now" button — composes the same summary this page shows into a plain-text
    email and logs it to the Outbox (type 'report', same as the not-yet-built scheduled report
    job would produce), sent to Settings' configured report_recipients."""
    from app.services.audit import audit
    from app.services.settings_service import get_settings

    vcs = filtered_visit_contacts(db, date_from=date_from, date_to=date_to, owner_id=owner_id,
                                   customer_category=customer_category, season=season)
    scope_all = not any([date_from, date_to, owner_id, customer_category, season])
    data = report_data(db, vcs, date.today(), scope_all_customers=scope_all)
    settings = get_settings(db)

    lines = [
        f"Follow-up report — as of {date.today().isoformat()}",
        "",
        f"Follow-ups in scope: {data['reached']['visits']}",
        f"Got a receipt/reply: {data['reached']['receipt']}",
        f"Prototype made: {data['reached']['proto']}",
        f"Order placed: {data['reached']['order']}",
        f"Average days from visit to order: {data['avg_cycle'] if data['avg_cycle'] is not None else '—'}",
        "",
        "Reply rate by email:",
    ]
    for s in data["stages"]:
        lines.append(f"  Mail {s['n']}: {s['resp']}/{s['sent']} ({round(s['rate'] * 100)}%)")
    lines.append("")
    lines.append(f"Blacklist A/B/C: {data['blacklist']['A']}/{data['blacklist']['B']}/{data['blacklist']['C']}")
    lines.append(f"Customers in scope: {data['customers']}")

    recipients = settings.get("report_recipients") or ""
    to_email = recipients.split(",")[0].strip() if recipients else "senior.management@example.com"
    cc = ",".join(e.strip() for e in recipients.split(",")[1:]) or None

    from app.models.misc import Outbox
    entry = Outbox(
        to_email=to_email, cc=cc, subject=f"Follow-up report — {date.today().isoformat()}",
        body="\n".join(lines), status="sent", sent_at=date.today(),
    )
    db.add(entry)
    audit(db, user_id=user.id, action="email_report_now", entity_type="settings",
          detail={"to": to_email, "filters": {"from": str(date_from) if date_from else None, "to": str(date_to) if date_to else None, "owner": str(owner_id) if owner_id else None, "category": customer_category, "season": season}})
    db.commit()
    return {"sent": True, "to": to_email, "cc": cc}
