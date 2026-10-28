import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_manager_up
from app.core.errors import not_found, validation_error
from app.models.blacklist import Exception_
from app.models.customer import Contact, Customer
from app.models.fabric import Fabric
from app.models.user import User
from app.models.visit import Visit, VisitContact, VisitItem
from app.schemas.visit import (
    RecordOrderIn, UndoOrderIn, VisitContactOut, VisitCreate, VisitImportResult, VisitImportRow, VisitOut,
)
from app.services.audit import audit
from app.services.blacklist_eval import evaluate_blacklists
from app.services.blacklist_service import can_issue_swatches
from app.services.mail_engine import create_mails, derive_outcome
from app.services.notify import notify_user
from app.services.settings_service import get_settings
from app.models.enums import sv
from app.models.mail import ItemFeedback, Mail

router = APIRouter(prefix="/visits", tags=["visits"])


def _visible_query(user: User):
    q = select(Visit).options(
        selectinload(Visit.visit_contacts).selectinload(VisitContact.items)
    )
    if user.role.value == "design":
        q = q.where(Visit.owner_id == user.id)
    return q


@router.get("", response_model=list[VisitOut])
def list_visits(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Visit]:
    return db.scalars(_visible_query(user).order_by(Visit.date.desc())).all()


@router.get("/{visit_id}", response_model=VisitOut)
def get_visit(visit_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Visit:
    visit = db.scalar(_visible_query(user).where(Visit.id == visit_id))
    if not visit:
        raise not_found("Visit not found")
    # Attach each item's latest visit-entry-time feedback (mail_response_id IS NULL) as a
    # transient attribute — a single-visit page, so the extra per-item lookup is cheap, and it's
    # the only place this is needed (Presentation/VisitContactDetail both load the visit by id).
    item_ids = [it.id for vc in visit.visit_contacts for it in vc.items]
    if item_ids:
        rows = db.scalars(
            select(ItemFeedback).where(ItemFeedback.visit_item_id.in_(item_ids), ItemFeedback.mail_response_id.is_(None))
            .order_by(ItemFeedback.logged_at.desc())
        ).all()
        latest_by_item: dict[uuid.UUID, ItemFeedback] = {}
        for row in rows:
            latest_by_item.setdefault(row.visit_item_id, row)
        logger_ids = {row.logged_by_user_id for row in latest_by_item.values() if row.logged_by_user_id}
        users_by_id = {u.id: u for u in db.scalars(select(User).where(User.id.in_(logger_ids)))} if logger_ids else {}
        for vc in visit.visit_contacts:
            for it in vc.items:
                fb = latest_by_item.get(it.id)
                it.visit_entry_feedback = (
                    {
                        "sentiment": fb.sentiment,
                        "text": fb.text,
                        "attachment_url": fb.attachment_url,
                        "logged_by": users_by_id.get(fb.logged_by_user_id).name if fb.logged_by_user_id in users_by_id else None,
                        "logged_at": fb.logged_at.isoformat(),
                    }
                    if fb else None
                )
    return visit


@router.post("", response_model=VisitOut, status_code=201)
def create_visit(payload: VisitCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Visit:
    settings = get_settings(db)

    customer = db.get(Customer, payload.customer_id)
    if not customer or (user.role.value == "design" and customer.owner_id != user.id):
        raise validation_error("Select the company")

    if payload.date > date.today():
        raise validation_error("Visit date cannot be empty or in the future")

    active_exc = db.scalar(
        select(Exception_).where(Exception_.customer_id == customer.id, Exception_.status == "approved")
        .order_by(Exception_.created_at.desc())
    )
    if not can_issue_swatches(customer, active_exc, payload.date):
        raise validation_error(f"{customer.name} is blacklisted — an exception from all Top Management is needed")

    attendees = {c.id: c for c in db.scalars(select(Contact).where(Contact.id.in_(payload.attendee_contact_ids)))}
    for cid in payload.attendee_contact_ids:
        contact = attendees.get(cid)
        if not contact or contact.customer_id != customer.id:
            raise validation_error("One of the attendees does not belong to this customer")

    fabrics_by_code: dict[str, Fabric] = {}
    for line in payload.lines:
        if line.representative_contact_id not in attendees:
            raise validation_error(
                f"Representative on sort no. {line.fabric_code} is not in the attendees list above"
            )
        if line.fabric_code not in fabrics_by_code:
            fabric = db.scalar(select(Fabric).where(Fabric.code == line.fabric_code))
            if not fabric:
                raise validation_error(f"Unknown sort no. {line.fabric_code} — add it under Masters › Items first")
            if sv(fabric.status) != "active":
                raise validation_error(f"{fabric.code} is inactive in the item master, cannot be distributed")
            fabrics_by_code[line.fabric_code] = fabric

    presenters = []
    if payload.presented_by:
        found = {u.id for u in db.scalars(select(User).where(User.id.in_(payload.presented_by)))}
        missing = set(payload.presented_by) - found
        if missing:
            raise validation_error("One of the 'Presented by' users does not exist")
        presenters = [str(uid) for uid in payload.presented_by]

    visit = Visit(customer_id=customer.id, owner_id=user.id, date=payload.date,
                   collections=payload.collections, way_forward=payload.way_forward,
                   presented_by=presenters or None, attachments=payload.attachments or None)
    db.add(visit)
    db.flush()

    vc_by_contact: dict[uuid.UUID, VisitContact] = {}
    for cid in payload.attendee_contact_ids:
        vc = VisitContact(visit_id=visit.id, contact_id=cid)
        db.add(vc)
        vc_by_contact[cid] = vc
    db.flush()

    now = datetime.now(timezone.utc)
    for line in payload.lines:
        vc = vc_by_contact[line.representative_contact_id]
        fabric = fabrics_by_code[line.fabric_code]
        item = VisitItem(visit_contact_id=vc.id, fabric_id=fabric.id, swatch_type=line.swatch_type, qty=line.qty)
        db.add(item)
        if line.sentiment or (line.feedback_text and line.feedback_text.strip()) or (line.attachment_url and line.attachment_url.strip()):
            db.flush()  # need item.id before attaching feedback to it
            db.add(ItemFeedback(
                visit_item_id=item.id, sentiment=line.sentiment or None,
                text=line.feedback_text.strip() if line.feedback_text else None,
                attachment_url=line.attachment_url.strip() if line.attachment_url else None,
                logged_by_user_id=user.id, logged_at=now,
            ))
    db.flush()

    # Auto-generate the 5-mail follow-up schedule for every attendee who was actually given
    # something, in the SAME transaction as the visit save (§6 validation doc — never leave a
    # visit with no follow-up mails).
    attendees_with_items = {ln.representative_contact_id for ln in payload.lines}
    for cid, vc in vc_by_contact.items():
        if cid in attendees_with_items:
            create_mails(db, vc, settings)

    if customer.blacklist_cat and active_exc and can_issue_swatches(customer, active_exc, payload.date):
        # §6 validation doc: the exception is consumed by exactly this one visit, in this same
        # transaction, so it can never cover more than the single visit it was granted for.
        active_exc.used_on_visit_id = visit.id

    audit(db, user_id=user.id, action="create_visit", entity_type="visit", entity_id=visit.id,
          detail={"customer": customer.name, "attendees": len(payload.attendee_contact_ids), "lines": len(payload.lines)})
    db.commit()
    db.refresh(visit)
    return visit


@router.post("/import", response_model=VisitImportResult)
def import_visits(rows: list[VisitImportRow], db: Session = Depends(get_db), user: User = Depends(require_manager_up)) -> VisitImportResult:
    """Bulk-backfill historical visits (see VisitImportRow's docstring for the two deliberate
    differences from live New Visit Entry: no blacklist gate, no follow-up mail schedule).
    Validate-everything-first, all-or-nothing — same convention as /customers/import and
    /fabrics/import. Rows are grouped into one Visit per (customer, visit_date, collections);
    the visit's owner is the customer's own assigned account owner, not whoever runs the import.
    Re-running the same file twice creates duplicate visits — nothing here checks for an
    already-imported match, so dedupe your CSV before uploading, same as the other two importers."""
    errors: list[str] = []
    customer_cache: dict[str, Customer | None] = {}
    fabric_cache: dict[str, Fabric | None] = {}
    groups: dict[tuple, dict] = {}

    for i, row in enumerate(rows, start=1):
        cust_key = row.customer_name.strip().lower()
        if cust_key not in customer_cache:
            customer_cache[cust_key] = db.scalar(
                select(Customer).options(selectinload(Customer.contacts)).where(Customer.name.ilike(row.customer_name.strip()))
            )
        customer = customer_cache[cust_key]
        if not customer:
            errors.append(f"Row {i}: no customer named '{row.customer_name}'")
            continue

        contact = next((c for c in customer.contacts if c.name.strip().lower() == row.contact_name.strip().lower()), None)
        if not contact:
            errors.append(f"Row {i}: '{customer.name}' has no contact named '{row.contact_name}'")
            continue

        if row.fabric_code not in fabric_cache:
            fabric_cache[row.fabric_code] = db.scalar(select(Fabric).where(Fabric.code == row.fabric_code))
        fabric = fabric_cache[row.fabric_code]
        if not fabric:
            errors.append(f"Row {i}: unknown sort no. '{row.fabric_code}' — add it under Items first")
            continue
        if sv(fabric.status) != "active":
            errors.append(f"Row {i}: '{fabric.code}' is inactive in the item master, cannot be distributed")
            continue

        if row.visit_date > date.today():
            errors.append(f"Row {i}: visit date cannot be in the future")
            continue

        key = (customer.id, row.visit_date, row.collections)
        group = groups.get(key)
        if group is None:
            group = {"customer": customer, "visit_date": row.visit_date, "collections": row.collections,
                      "way_forward": row.way_forward, "lines": []}
            groups[key] = group
        group["lines"].append({"contact": contact, "fabric": fabric, "swatch_type": row.swatch_type, "qty": row.qty})

    if errors:
        raise validation_error("Fix these rows and re-import — nothing was saved.", fields={"rows": errors})

    created = 0
    for group in groups.values():
        customer = group["customer"]
        visit = Visit(customer_id=customer.id, owner_id=customer.owner_id, date=group["visit_date"],
                       collections=group["collections"], way_forward=group["way_forward"])
        db.add(visit)
        db.flush()
        vc_by_contact: dict[uuid.UUID, VisitContact] = {}
        for line in group["lines"]:
            cid = line["contact"].id
            if cid not in vc_by_contact:
                vc = VisitContact(visit_id=visit.id, contact_id=cid)
                db.add(vc)
                vc_by_contact[cid] = vc
        db.flush()
        for line in group["lines"]:
            vc = vc_by_contact[line["contact"].id]
            db.add(VisitItem(visit_contact_id=vc.id, fabric_id=line["fabric"].id, swatch_type=line["swatch_type"], qty=line["qty"]))
        created += 1

    audit(db, user_id=user.id, action="import_visits", entity_type="visit", detail={"created": created, "rows": len(rows)})
    db.commit()
    return VisitImportResult(created=created)


def _owned_visit_contact(db: Session, user: User, vc_id: uuid.UUID) -> tuple[VisitContact, Visit]:
    vc = db.get(VisitContact, vc_id)
    if not vc:
        raise not_found("Visit not found")
    visit = db.get(Visit, vc.visit_id)
    if user.role.value == "design" and visit.owner_id != user.id:
        raise not_found("Visit not found")
    return vc, visit


@router.post("/contacts/{vc_id}/record-order", response_model=VisitContactOut)
def record_order(vc_id: uuid.UUID, payload: RecordOrderIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> VisitContact:
    """Staff action for an order heard about before any mail reply (phone call, in person) —
    App.recordOrder()/doRecordOrder() in actions.js. Stops the remaining question emails and turns
    Mail 5 into the order-status email, exactly like a customer-reported order would."""
    vc, visit = _owned_visit_contact(db, user, vc_id)
    settings = get_settings(db)
    if payload.order_date > date.today() or payload.order_date < visit.date:
        raise validation_error("Pick a date between the visit and today")
    item_codes = {
        db.get(Fabric, i.fabric_id).code for i in db.scalars(select(VisitItem).where(VisitItem.visit_contact_id == vc.id))
    }
    unknown = set(payload.fabric_codes) - item_codes
    if unknown:
        raise validation_error(f"Not shared on this visit: {', '.join(sorted(unknown))}")

    last_sent = db.scalar(
        select(Mail.mail_number).where(Mail.visit_contact_id == vc.id, Mail.status != "scheduled")
        .order_by(Mail.mail_number.desc()).limit(1)
    ) or 0

    vc.manual_order_date = payload.order_date
    vc.manual_order_fabrics = payload.fabric_codes
    vc.manual_order_after_mail = last_sent
    vc.manual_order_by = user.name
    vc.manual_order_note = payload.note

    derive_outcome(db, vc, settings)
    audit(db, user_id=user.id, action="Recorded an order", entity_type="visit_contact", entity_id=vc.id,
          detail={"fabrics": payload.fabric_codes, "note": payload.note})
    evaluate_blacklists(db, date.today())
    db.commit()
    db.refresh(vc)
    return vc


@router.post("/contacts/{vc_id}/undo-order", response_model=VisitContactOut)
def undo_order(vc_id: uuid.UUID, payload: UndoOrderIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> VisitContact:
    """App.undoOrder()/doUndoOrder(): removes a manually-recorded order. Question emails that were
    auto-skipped come back on in derive_outcome() — unless something later in the sequence has
    already gone out, matching the prototype's restore guard."""
    vc, visit = _owned_visit_contact(db, user, vc_id)
    settings = get_settings(db)
    if not vc.manual_order_date:
        raise validation_error("No manually-recorded order on this visit to undo")

    recorded_by = vc.manual_order_by
    recorded_date = vc.manual_order_date
    vc.manual_order_date = None
    vc.manual_order_fabrics = None
    vc.manual_order_after_mail = None
    vc.manual_order_by = None
    vc.manual_order_note = None

    derive_outcome(db, vc, settings)
    audit(db, user_id=user.id, action="Undid a recorded order", entity_type="visit_contact", entity_id=vc.id,
          detail={"reason": payload.reason, "was_recorded_by": recorded_by, "was_recorded_on": recorded_date.isoformat() if recorded_date else None})
    evaluate_blacklists(db, date.today())
    db.commit()
    db.refresh(vc)
    return vc
