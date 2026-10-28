"""Blacklist governance (A/B/C) and the exception workflow — §6 of the validation doc.

The system only ever SUGGESTS a blacklist category or an exception; either one only takes effect
once EVERY current Top Management ('top' role) user has approved it — a single 'no' rejects it
immediately (asymmetric by design, never a majority vote). "Every current" is re-read at the
moment of each decision, not frozen at proposal time: if a new top user joins while a proposal is
pending, their approval is needed too (the open question flagged in the validation doc — resolved
this way to match the prototype's `topUsers().every(...)` check, which always re-reads the live
user list).

Row locking: deciding a proposal/exception takes a `SELECT ... FOR UPDATE` lock on the parent row
for the duration of the decision, so two Top Management members submitting a decision at the same
instant can't both read a stale "not yet unanimous" state and neither one sees the flip to
approved/rejected.
"""
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import conflict, validation_error
from app.models.blacklist import Approval, BlacklistEvent, Exception_
from app.models.customer import Customer
from app.models.enums import ApprovalParentEnum, RoleEnum, sv
from app.models.mail import Mail
from app.models.user import User
from app.models.visit import Visit, VisitContact
from app.services.audit import audit
from app.services.notify import notify_managers, notify_user

BL_TEXT = {
    "A": {"rule": "Replied only to Mail 5, not to the earlier 4 mails", "act": "Intimation to senior management and Marketing Head"},
    "B": {"rule": "Replied to some mails but gave no closure or feedback, and is only in touch with the marketing team", "act": "Intimation to the customer's company email"},
    "C": {"rule": "No response on feedback & closure for 2 consecutive seasons", "act": "Do not present new collections (Mail 5B not sent)"},
}


def exception_active(exc: Exception_ | None, today: date) -> bool:
    """§6 validation doc: approved, not yet used, still within its validity window."""
    return bool(exc and sv(exc.status) == "approved" and exc.used_on_visit_id is None and exc.valid_till and today <= exc.valid_till)


def can_issue_swatches(customer: Customer, active_exception: Exception_ | None, today: date) -> bool:
    if not customer.blacklist_cat:
        return True
    return exception_active(active_exception, today)


def current_top_user_ids(db: Session) -> set[uuid.UUID]:
    return {u.id for u in db.scalars(select(User).where(User.role == RoleEnum.top, User.is_active == True))}  # noqa: E712


def _is_unanimous(db: Session, parent_type: ApprovalParentEnum, parent_id: uuid.UUID) -> bool:
    top_ids = current_top_user_ids(db)
    if not top_ids:
        return False
    approvals = {
        a.approver_id: a.decision
        for a in db.scalars(select(Approval).where(Approval.parent_type == parent_type, Approval.parent_id == parent_id))
    }
    return all(approvals.get(t) is True for t in top_ids)


def restore_c_skipped_mails(db: Session, customer: Customer) -> int:
    """§6/§7: once Blacklist C clears, any Mail 5 the scheduler auto-skipped under the C gate
    (mail_blocked_by_c) goes back to 'scheduled'."""
    vc_ids = [
        vc.id for vc in db.scalars(
            select(VisitContact).join(Visit).where(Visit.customer_id == customer.id)
        )
    ]
    if not vc_ids:
        return 0
    restored = 0
    for mail in db.scalars(select(Mail).where(Mail.visit_contact_id.in_(vc_ids), Mail.c_skip == True)):  # noqa: E712
        if sv(mail.status) == "skipped":
            mail.status = "scheduled"
            mail.c_skip = False
            mail.note = "Restored — Blacklist C cleared"
            restored += 1
    return restored


# ---------- blacklist proposals ----------

def suggest_blacklist(db: Session, *, customer: Customer, cat: str, reason: str, by_user_id: uuid.UUID) -> BlacklistEvent:
    if customer.blacklist_cat == cat:
        raise conflict(f"{customer.name} is already Blacklist {cat}")
    existing = db.scalar(
        select(BlacklistEvent).where(BlacklistEvent.customer_id == customer.id, BlacklistEvent.status == "pending")
    )
    if existing:
        raise conflict(f"A Blacklist {existing.cat.value} suggestion is already pending Top Management's decision")
    event = BlacklistEvent(customer_id=customer.id, cat=cat, reason=reason, status="pending")
    db.add(event)
    db.flush()
    audit(db, user_id=by_user_id, action=f"Suggested Blacklist {cat}", entity_type="blacklist_event", entity_id=event.id,
          detail={"customer": customer.name, "reason": reason})
    for top_id in current_top_user_ids(db):
        notify_user(db, top_id, f"{customer.name}: Blacklist {cat} suggested — your approval is needed", "/blacklist")
    notify_user(db, customer.owner_id, f"{customer.name} suggested for Blacklist {cat} — waiting for Top Management", f"/customer/{customer.id}")
    return event


def decide_blacklist_event(db: Session, *, event_id: uuid.UUID, approver: User, yes: bool, note: str | None) -> BlacklistEvent:
    event = db.scalar(select(BlacklistEvent).where(BlacklistEvent.id == event_id).with_for_update())
    if not event:
        raise validation_error("Blacklist suggestion not found")
    if sv(event.status) != "pending":
        raise conflict("This suggestion has already been decided")

    existing_approval = db.scalar(
        select(Approval).where(Approval.parent_type == ApprovalParentEnum.blacklist_event, Approval.parent_id == event.id,
                                Approval.approver_id == approver.id)
    )
    if existing_approval:
        raise conflict("You have already recorded a decision on this suggestion")
    db.add(Approval(parent_type=ApprovalParentEnum.blacklist_event, parent_id=event.id, approver_id=approver.id, decision=yes, note=note))
    db.flush()

    customer = db.get(Customer, event.customer_id)
    if not yes:
        event.status = "rejected"
        audit(db, user_id=approver.id, action=f"Rejected Blacklist {event.cat.value}", entity_type="blacklist_event", entity_id=event.id, detail={"note": note})
        notify_user(db, customer.owner_id, f"Top Management did not approve Blacklist {event.cat.value} for {customer.name}", f"/customer/{customer.id}")
        return event

    if _is_unanimous(db, ApprovalParentEnum.blacklist_event, event.id):
        event.status = "approved"
        customer.blacklist_cat = event.cat
        audit(db, user_id=approver.id, action=f"Blacklist {event.cat.value} approved by all Top Management", entity_type="blacklist_event", entity_id=event.id, detail={"reason": event.reason})
        notify_user(db, customer.owner_id, f"{customer.name} is now Blacklist {event.cat.value} — {BL_TEXT[event.cat.value]['act']}", f"/customer/{customer.id}")
        notify_managers(db, f"{customer.name} is now Blacklist {event.cat.value}", f"/customer/{customer.id}")
    else:
        audit(db, user_id=approver.id, action=f"Approved Blacklist {event.cat.value} (waiting for other Top Management)", entity_type="blacklist_event", entity_id=event.id, detail={"note": note})
    return event


def clear_blacklist(db: Session, *, customer: Customer, reason: str, by_user_id: uuid.UUID, today: date | None = None) -> None:
    """Manual clear (admin) — App.removeFromBlacklist() in the prototype. Also pushes
    whitelist_after forward to today so the automatic evaluator (app/services/blacklist_eval.py)
    can't immediately re-raise the same old evidence that was just cleared by hand."""
    if not customer.blacklist_cat:
        raise validation_error(f"{customer.name} is not currently blacklisted")
    cat = customer.blacklist_cat.value
    customer.blacklist_cat = None
    customer.whitelist_after = today or date.today()
    pending_exc = db.scalar(select(Exception_).where(Exception_.customer_id == customer.id, Exception_.status == "pending"))
    if pending_exc:
        pending_exc.status = "rejected"
    pending_event = db.scalar(select(BlacklistEvent).where(BlacklistEvent.customer_id == customer.id, BlacklistEvent.status == "pending"))
    if pending_event:
        pending_event.status = "withdrawn"
    restored = restore_c_skipped_mails(db, customer)
    audit(db, user_id=by_user_id, action=f"Blacklist {cat} cleared", entity_type="customer", entity_id=customer.id,
          detail={"reason": reason, "mails_restored": restored})
    notify_user(db, customer.owner_id, f"{customer.name} removed from Blacklist {cat} — {reason}", f"/customer/{customer.id}")
    notify_managers(db, f"{customer.name} removed from Blacklist {cat}", f"/customer/{customer.id}")


# ---------- exceptions ----------

def request_exception(db: Session, *, customer: Customer, reason: str, by_user_id: uuid.UUID) -> Exception_:
    if not customer.blacklist_cat:
        raise validation_error(f"{customer.name} is not blacklisted — no exception is needed")
    if db.scalar(select(Exception_).where(Exception_.customer_id == customer.id, Exception_.status == "pending")):
        raise conflict("An exception request for this customer is already pending")
    exc = Exception_(customer_id=customer.id, requested_by=by_user_id, reason=reason, status="pending")
    db.add(exc)
    db.flush()
    audit(db, user_id=by_user_id, action="Requested an exception", entity_type="exception", entity_id=exc.id, detail={"customer": customer.name, "reason": reason})
    for top_id in current_top_user_ids(db):
        notify_user(db, top_id, f"Exception requested for {customer.name} (Blacklist {customer.blacklist_cat.value})", "/blacklist")
    return exc


def decide_exception(db: Session, *, exception_id: uuid.UUID, approver: User, yes: bool, note: str | None, today: date) -> Exception_:
    exc = db.scalar(select(Exception_).where(Exception_.id == exception_id).with_for_update())
    if not exc:
        raise validation_error("Exception request not found")
    if sv(exc.status) != "pending":
        raise conflict("This exception request has already been decided")

    existing_approval = db.scalar(
        select(Approval).where(Approval.parent_type == ApprovalParentEnum.exception, Approval.parent_id == exc.id,
                                Approval.approver_id == approver.id)
    )
    if existing_approval:
        raise conflict("You have already recorded a decision on this exception")
    db.add(Approval(parent_type=ApprovalParentEnum.exception, parent_id=exc.id, approver_id=approver.id, decision=yes, note=note))
    db.flush()

    customer = db.get(Customer, exc.customer_id)
    if not yes:
        exc.status = "rejected"
        audit(db, user_id=approver.id, action="Exception rejected", entity_type="exception", entity_id=exc.id, detail={"note": note})
        notify_user(db, exc.requested_by, f"Exception for {customer.name} was not approved", f"/customer/{customer.id}")
        return exc

    if _is_unanimous(db, ApprovalParentEnum.exception, exc.id):
        exc.status = "approved"
        exc.valid_till = today + timedelta(days=30)
        audit(db, user_id=approver.id, action="Exception approved for one visit", entity_type="exception", entity_id=exc.id, detail={"valid_till": exc.valid_till.isoformat()})
        notify_user(db, exc.requested_by, f"Exception approved — you can log one visit for {customer.name} until {exc.valid_till.isoformat()}", f"/customer/{customer.id}")
    else:
        audit(db, user_id=approver.id, action="Approved exception (waiting for other Top Management)", entity_type="exception", entity_id=exc.id, detail={"note": note})
    return exc
