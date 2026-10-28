"""Blacklist governance (A/B/C) & exceptions — §6 of the validation doc. See
app/services/blacklist_service.py for the unanimous-Top-Management / row-locking rules this
router enforces; the endpoints here are thin wrappers that gate by role and shape the response.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin, require_manager_up, require_top
from app.core.errors import not_found
from app.models.blacklist import Approval, BlacklistEvent, Exception_
from app.models.customer import Customer
from app.models.user import User
from app.schemas.blacklist import (
    ApprovalOut,
    BlacklistEventOut,
    ClearBlacklistIn,
    DecideIn,
    ExceptionOut,
    RequestExceptionIn,
    SuggestBlacklistIn,
)
from app.services.blacklist_service import (
    BL_TEXT,
    clear_blacklist,
    decide_blacklist_event,
    decide_exception,
    request_exception,
    suggest_blacklist,
)

router = APIRouter(tags=["blacklist"])


def _get_customer(db: Session, customer_id: uuid.UUID) -> Customer:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise not_found("Customer not found")
    return customer


@router.get("/blacklist/pending")
def list_pending(db: Session = Depends(get_db), _: User = Depends(require_manager_up)) -> dict:
    """Everyone manager-and-up can see what's awaiting Top Management; only 'top' can decide."""
    events = db.scalars(select(BlacklistEvent).where(BlacklistEvent.status == "pending")).all()
    exceptions = db.scalars(select(Exception_).where(Exception_.status == "pending")).all()
    return {
        "blacklist_events": [BlacklistEventOut.model_validate(e).model_dump() for e in events],
        "exceptions": [ExceptionOut.model_validate(e).model_dump() for e in exceptions],
    }


@router.get("/customers/{customer_id}/blacklist-events", response_model=list[BlacklistEventOut])
def list_customer_events(customer_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_manager_up)) -> list[BlacklistEvent]:
    _get_customer(db, customer_id)
    return db.scalars(select(BlacklistEvent).where(BlacklistEvent.customer_id == customer_id).order_by(BlacklistEvent.created_at.desc())).all()


@router.get("/blacklist-events/{event_id}/approvals", response_model=list[ApprovalOut])
def list_event_approvals(event_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_manager_up)) -> list[Approval]:
    from app.models.enums import ApprovalParentEnum
    return db.scalars(select(Approval).where(Approval.parent_type == ApprovalParentEnum.blacklist_event, Approval.parent_id == event_id)).all()


@router.post("/customers/{customer_id}/blacklist/suggest", response_model=BlacklistEventOut, status_code=201)
def suggest(customer_id: uuid.UUID, payload: SuggestBlacklistIn, db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> BlacklistEvent:
    customer = _get_customer(db, customer_id)
    event = suggest_blacklist(db, customer=customer, cat=payload.cat.value, reason=payload.reason, by_user_id=user.id)
    db.commit()
    db.refresh(event)
    return event


@router.post("/blacklist-events/{event_id}/decide", response_model=BlacklistEventOut)
def decide_event(event_id: uuid.UUID, payload: DecideIn, db: Session = Depends(get_db), user: User = Depends(require_top)) -> BlacklistEvent:
    event = decide_blacklist_event(db, event_id=event_id, approver=user, yes=payload.decision, note=payload.note)
    db.commit()
    db.refresh(event)
    return event


@router.post("/customers/{customer_id}/blacklist/clear")
def clear(customer_id: uuid.UUID, payload: ClearBlacklistIn, db: Session = Depends(get_db), user: User = Depends(require_admin)) -> dict:
    customer = _get_customer(db, customer_id)
    clear_blacklist(db, customer=customer, reason=payload.reason, by_user_id=user.id)
    db.commit()
    return {"ok": True}


@router.get("/customers/{customer_id}/exceptions", response_model=list[ExceptionOut])
def list_customer_exceptions(customer_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_manager_up)) -> list[Exception_]:
    _get_customer(db, customer_id)
    return db.scalars(select(Exception_).where(Exception_.customer_id == customer_id).order_by(Exception_.created_at.desc())).all()


@router.post("/customers/{customer_id}/exceptions", response_model=ExceptionOut, status_code=201)
def request_exc(customer_id: uuid.UUID, payload: RequestExceptionIn, db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> Exception_:
    customer = _get_customer(db, customer_id)
    exc = request_exception(db, customer=customer, reason=payload.reason, by_user_id=user.id)
    db.commit()
    db.refresh(exc)
    return exc


@router.post("/exceptions/{exception_id}/decide", response_model=ExceptionOut)
def decide_exc(exception_id: uuid.UUID, payload: DecideIn, db: Session = Depends(get_db), user: User = Depends(require_top)) -> Exception_:
    exc = decide_exception(db, exception_id=exception_id, approver=user, yes=payload.decision, note=payload.note, today=date.today())
    db.commit()
    db.refresh(exc)
    return exc


@router.get("/customers/{customer_id}/blacklist-evidence")
def get_blacklist_evidence(customer_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_manager_up)) -> dict:
    """The 'Why?' modal (prototype's evidenceHtml()): rule text for the relevant category, the
    event/decision trail (with approvals), and — for auto-raised evidence, where we know exactly
    which visit-contacts triggered it (BlacklistEvent.sig) — the actual mail-by-mail send/reply
    trail for those visit-contacts, so a reviewer can see the real evidence, not just a reason
    string. Falls back gracefully (no mail trail) for an older manually-suggested event with no
    sig. Also includes this customer's blacklist-related audit history for a company-history view."""
    from app.models.enums import ApprovalParentEnum
    from app.models.visit import Visit, VisitContact
    from app.models.mail import Mail, MailResponse
    from app.models.misc import AuditLog

    customer = _get_customer(db, customer_id)

    # the event that's currently in force, or — if none is approved right now — the most recent
    # one of any status, so there's still something to show for a cleared/rejected history.
    event = db.scalar(
        select(BlacklistEvent).where(BlacklistEvent.customer_id == customer_id, BlacklistEvent.status == "approved")
        .order_by(BlacklistEvent.created_at.desc())
    )
    if not event:
        event = db.scalar(
            select(BlacklistEvent).where(BlacklistEvent.customer_id == customer_id)
            .order_by(BlacklistEvent.created_at.desc())
        )

    event_out = None
    mail_trail = []
    if event:
        approvals = db.scalars(
            select(Approval).where(Approval.parent_type == ApprovalParentEnum.blacklist_event, Approval.parent_id == event.id)
        ).all()
        event_out = {
            **BlacklistEventOut.model_validate(event).model_dump(),
            "rule": BL_TEXT[event.cat.value]["rule"],
            "action": BL_TEXT[event.cat.value]["act"],
            "auto_raised": event.auto_raised,
            "approvals": [ApprovalOut.model_validate(a).model_dump() for a in approvals],
        }
        if event.sig:
            vc_ids_str = event.sig.split(":", 1)[1] if ":" in event.sig else ""
            vc_ids = [uuid.UUID(x) for x in vc_ids_str.split(",") if x]
            for vc_id in vc_ids:
                vc = db.get(VisitContact, vc_id)
                if not vc:
                    continue
                visit = db.get(Visit, vc.visit_id)
                mails = db.scalars(select(Mail).where(Mail.visit_contact_id == vc_id).order_by(Mail.mail_number)).all()
                mail_rows = []
                for m in mails:
                    resp = db.scalar(select(MailResponse).where(MailResponse.mail_id == m.id).order_by(MailResponse.submitted_at.desc()).limit(1))
                    mail_rows.append({
                        "mail_number": m.mail_number,
                        "status": m.status.value,
                        "sent_at": m.sent_at.isoformat() if m.sent_at else None,
                        "replied": resp is not None,
                        "replied_at": resp.submitted_at.isoformat() if resp else None,
                        "reply_summary": (resp.raw_data if resp else None),
                    })
                mail_trail.append({"visit_contact_id": str(vc_id), "visit_date": visit.date.isoformat() if visit else None, "mails": mail_rows})

    exceptions = db.scalars(select(Exception_).where(Exception_.customer_id == customer_id).order_by(Exception_.created_at.desc())).all()
    history = db.scalars(
        select(AuditLog).where(AuditLog.entity_id == customer_id).order_by(AuditLog.created_at.desc()).limit(30)
    ).all()
    # also pull entries filed against the blacklist_event/exception rows themselves, so a decision
    # ("Approved Blacklist A ...") shows up even though its entity_id is the event, not the customer.
    related_ids = [e.id for e in db.scalars(select(BlacklistEvent).where(BlacklistEvent.customer_id == customer_id))]
    related_ids += [e.id for e in exceptions]
    if related_ids:
        history = list(history) + list(db.scalars(
            select(AuditLog).where(AuditLog.entity_id.in_(related_ids)).order_by(AuditLog.created_at.desc()).limit(30)
        ).all())
    history = sorted(history, key=lambda a: a.created_at, reverse=True)[:30]

    return {
        "customer_id": str(customer_id),
        "current_cat": customer.blacklist_cat.value if customer.blacklist_cat else None,
        "event": event_out,
        "mail_trail": mail_trail,
        "exceptions": [{**ExceptionOut.model_validate(e).model_dump()} for e in exceptions],
        "history": [
            {"action": h.action, "detail": h.detail, "created_at": h.created_at.isoformat()} for h in history
        ],
    }


@router.get("/blacklist/b-candidates")
def list_b_candidates(db: Session = Depends(get_db), _: User = Depends(require_manager_up)) -> list[dict]:
    """Companies that replied to their follow-ups but never gave feedback or a closure, and are
    NOT yet flagged 'only in touch with marketing' — the prototype's dashboard/Blacklist panel
    that asks the account owner to confirm before Blacklist B can even be suggested (confirming
    flips Customer.marketing_only, which immediately re-runs the evaluator — see customers.py)."""
    from datetime import date as _date
    from app.models.visit import Visit
    from app.services.blacklist_eval import b_candidate_vc
    from app.services.settings_service import get_settings

    settings = get_settings(db)
    today = _date.today()
    out = []
    candidates = db.scalars(
        select(Customer).where(Customer.blacklist_cat.is_(None), Customer.marketing_only == False)  # noqa: E712
    ).all()
    for customer in candidates:
        vc = b_candidate_vc(db, customer, today, settings)
        if not vc:
            continue
        visit = db.get(Visit, vc.visit_id)
        out.append({
            "customer_id": str(customer.id),
            "customer_name": customer.name,
            "owner_id": str(customer.owner_id),
            "visit_contact_id": str(vc.id),
            "visit_id": str(visit.id),
            "visit_date": visit.date.isoformat(),
        })
    return out


@router.post("/admin/evaluate-blacklists")
def trigger_blacklist_evaluation(target_date: date | None = None, db: Session = Depends(get_db), user: User = Depends(require_admin)) -> dict:
    """Manual trigger for the auto-evaluation engine (app/services/blacklist_eval.py) — also wired
    to run automatically after every customer response and at the end of each day's scheduler run."""
    from app.services.blacklist_eval import evaluate_blacklists
    result = evaluate_blacklists(db, target_date or date.today())
    db.commit()
    return result
